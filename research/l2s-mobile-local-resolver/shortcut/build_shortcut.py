#!/usr/bin/env python3
"""Build the experimental UniFetch L2S iOS/iPadOS Shortcut.

The generated shortcut is a transport-only fast path:

  share sheet -> validate Instagram URL -> anonymous bootstrap GET
  -> extract csrftoken -> fixed GraphQL POST -> copy public JSON
  -> open UniFetch /import#url=...

If the native path does not return JSON, the shortcut opens the existing
/share?url=... Worker flow instead. No account cookie, password, token, or
media URL is sent to UniFetch by this shortcut.

The workflow is intentionally small and uses only first-party Shortcuts
actions. It is EXPERIMENTAL and has not been run on an iPhone or iPad.

Usage:
  python3 build_shortcut.py             # write the unsigned XML plist
  python3 build_shortcut.py --sign      # also sign with Apple's shortcuts CLI

Signing requires macOS and the Shortcuts app. The signed output is written to
artifacts/ (gitignored) and is not part of the repository.
"""

from __future__ import annotations

import argparse
import plistlib
import subprocess
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
UNSIGNED = HERE / "UniFetch-L2S-Experimental.xml"
ARTIFACTS = ROOT / "artifacts"
SIGNED = ARTIFACTS / "UniFetch-L2S-Experimental.shortcut"

# Fixed, randomly generated UUIDs keep the generated XML stable and reviewable.
# They are action-output identifiers, not secrets.
UUID = {
    "links": "D668227A-A284-41F1-B071-B255037515F7",
    "if_input": "BE93D17E-8B11-4561-B954-77C910D35859",
    "first": "75DEE341-A1D6-416D-B5B2-16D7F6245E8A",
    "validate": "D2118360-B66F-4B83-A785-1C2F73A7543C",
    "if_valid": "5B5043AD-A50E-49AE-878F-1A723061793C",
    "boot_url": "2AC87FFE-40B5-4B9B-B817-978567DDE1F8",
    "boot": "81717989-4083-4DB4-A3D1-12DF236F2F89",
    "boot_text": "A71F7532-D996-4808-A441-EC1209727ABE",
    "token_match": "18A3E1B0-8A50-48B5-98DF-30B47C0C6C08",
    "if_token": "D6FBDADD-CA68-4501-8F72-1CE14D33607A",
    "token_group": "555A6D9B-E196-4D17-9C4D-DBED8CC45482",
    "csrf_var": "501B0B8E-6AAB-40E2-BC6F-C13D3E959908",
    "short_match": "EB8C472F-F885-4074-89D4-E0BE07FD0AC7",
    "short_group": "B7863645-CFAA-4C31-BA0C-B76B9623706F",
    "short_var": "52661B65-2B8A-4E9B-99A5-96BEA76FDB8B",
    "encode": "D6E970FF-6167-48DF-93F3-6AB1398BBD67",
    "fallback_url": "03E32F3A-7D27-4940-807C-4EF082814072",
    "json_body": "EB66328D-AACD-4267-B307-931C14C360D2",
    "gql": "E7CC0DE8-A415-4856-814A-F56CA5E14408",
    "gql_text": "183525E7-EBFB-4765-883F-3C769567CE9E",
    "if_json": "BD00826F-39D4-49D3-8CDF-17CB21E70928",
    "clip": "E50BB049-B7EA-45D9-BDD7-774CCF7EF237",
    "import_url": "605C7B66-064D-4A76-974D-DB57BC4834C8",
    "open": "D2CF4CC2-AC13-4F81-B5D6-EC74F76450E1",
}

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
URL_PATTERN = (
    r"^https://(?:www\.)?instagram\.com/(?:p|reel|reels)/"
    r"[A-Za-z0-9_-]+/?(?:\?[^\s#]*)?(?:#[^\s]*)?$"
)
TOKEN_PATTERN = r'"csrf_token":"([A-Za-z0-9_-]+)"'
SHORTCODE_PATTERN = r"instagram\.com/(?:p|reel|reels)/([A-Za-z0-9_-]+)"

PLACEHOLDER = "\ufffc"


def output(uuid: str, name: str) -> dict[str, Any]:
    return {"Type": "ActionOutput", "OutputUUID": uuid, "OutputName": name}


def token_string(parts: list[Any]) -> dict[str, Any]:
    """Build a WFTextTokenString from literal strings and token dicts."""
    text = ""
    attachments: dict[str, Any] = {}
    for part in parts:
        if isinstance(part, str):
            text += part
            continue
        start = len(text)
        text += PLACEHOLDER
        attachments[f"{{{start}, 1}}"] = part
    value: dict[str, Any] = {"string": text}
    if attachments:
        value["attachmentsByRange"] = attachments
    return {"Value": value, "WFSerializationType": "WFTextTokenString"}


def attachment(uuid: str, name: str) -> dict[str, Any]:
    return {
        "Value": output(uuid, name),
        "WFSerializationType": "WFTextTokenAttachment",
    }


def variable_attachment(name: str) -> dict[str, Any]:
    return {
        "Value": {"Type": "Variable", "VariableName": name},
        "WFSerializationType": "WFTextTokenAttachment",
    }


def conditional_input(uuid: str, name: str) -> dict[str, Any]:
    return {
        "Type": "Variable",
        "Variable": attachment(uuid, name),
    }


def header(key: str, value: str | dict[str, Any]) -> dict[str, Any]:
    return {
        "WFItemType": 0,
        "WFKey": {
            "Value": {"string": key},
            "WFSerializationType": "WFTextTokenString",
        },
        "WFValue": (
            value
            if isinstance(value, dict)
            else {
                "Value": {"string": value},
                "WFSerializationType": "WFTextTokenString",
            }
        ),
    }


def headers(items: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "Value": {"WFDictionaryFieldValueItems": items},
        "WFSerializationType": "WFDictionaryFieldValue",
    }


def comment(text: str) -> dict[str, Any]:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.comment",
        "WFWorkflowActionParameters": {"WFCommentActionText": text},
    }


def alert(title: str, message: str) -> dict[str, Any]:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.alert",
        "WFWorkflowActionParameters": {
            "WFAlertActionTitle": title,
            "WFAlertActionMessage": message,
            "WFAlertActionCancelButtonShown": False,
        },
    }


def if_start(group: str, condition: int, input_value: dict[str, Any], **extra: Any):
    params: dict[str, Any] = {
        "GroupingIdentifier": group,
        "WFControlFlowMode": 0,
        "WFCondition": condition,
        "WFInput": input_value,
    }
    params.update(extra)
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
        "WFWorkflowActionParameters": params,
    }


def if_else(group: str) -> dict[str, Any]:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
        "WFWorkflowActionParameters": {
            "GroupingIdentifier": group,
            "WFControlFlowMode": 1,
        },
    }


def if_end(group: str) -> dict[str, Any]:
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
        "WFWorkflowActionParameters": {
            "GroupingIdentifier": group,
            "WFControlFlowMode": 2,
        },
    }


def build_actions() -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []

    actions += [
        comment(
            "UniFetch L2S experimental native transport. Fetches one public "
            "Instagram post's metadata from the device, then hands the raw "
            "public JSON to the UniFetch Web parser. If the native request "
            "does not return JSON, it opens the standard UniFetch resolver."
        ),
        comment(
            "Shortcuts generated by Shortcuts Playground. May contain mistakes. "
            "Always check the shortcut's actions first.\n\n"
            "This shortcut was created via the following user prompt:\n\n"
            "> Build an experimental UniFetch iOS/iPadOS Shortcut that validates "
            "one shared Instagram post/Reel URL, performs one anonymous Instagram "
            "bootstrap GET and one fixed GraphQL POST from the device, copies the "
            "bounded public JSON to the clipboard, and opens the UniFetch /import "
            "handoff. If the native path fails, open the existing /share Worker "
            "flow. Do not export credentials."
        ),
        comment(
            "--- SHARE INPUT ---\n"
            "- Input uses the item passed by the share sheet\n"
            "- URLs extracts links from the shared item"
        ),
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.detect.link",
            "WFWorkflowActionParameters": {
                "UUID": UUID["links"],
                "WFInput": token_string([{"Type": "ExtensionInput"}]),
            },
        },
        comment(
            "--- SHARE INPUT CHECK ---\n"
            "- URLs checks whether the shared item contained any link"
        ),
        if_start(
            UUID["if_input"],
            100,
            conditional_input(UUID["links"], "URLs"),
        ),
        comment(
            "--- URL VALIDATION ---\n"
            "- Item from List uses the first extracted URL\n"
            "- Matches checks that the URL is a supported Instagram post or Reel"
        ),
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.getitemfromlist",
            "WFWorkflowActionParameters": {
                "UUID": UUID["first"],
                "WFItemSpecifier": "First Item",
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.text.match",
            "WFWorkflowActionParameters": {
                "UUID": UUID["validate"],
                "WFMatchTextPattern": URL_PATTERN,
                "WFMatchTextCaseSensitive": False,
                "text": token_string([output(UUID["first"], "Item from List")]),
            },
        },
        comment(
            "--- SUPPORTED URL CHECK ---\n"
            "- Matches checks whether the first shared URL is supported"
        ),
        if_start(
            UUID["if_valid"],
            100,
            conditional_input(UUID["validate"], "Matches"),
        ),
        comment("--- ANONYMOUS BOOTSTRAP AND CSRF TOKEN ---"),
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.url",
            "WFWorkflowActionParameters": {
                "UUID": UUID["boot_url"],
                "WFURLActionURL": "https://www.instagram.com/",
                "Show-WFURLActionURL": True,
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
            "WFWorkflowActionParameters": {
                "UUID": UUID["boot"],
                "WFURL": token_string([output(UUID["boot_url"], "URL")]),
                "WFHTTPMethod": "GET",
                "WFHTTPHeaders": headers(
                    [
                        header(
                            "Accept",
                            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        ),
                        header("Accept-Language", "en-US,en;q=0.8"),
                        header("User-Agent", UA),
                        header("Cache-Control", "no-cache"),
                        header("Pragma", "no-cache"),
                    ]
                ),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.detect.text",
            "WFWorkflowActionParameters": {
                "UUID": UUID["boot_text"],
                "WFInput": attachment(UUID["boot"], "Contents of URL"),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.text.match",
            "WFWorkflowActionParameters": {
                "UUID": UUID["token_match"],
                "WFMatchTextPattern": TOKEN_PATTERN,
                "WFMatchTextCaseSensitive": False,
                "text": token_string([output(UUID["boot_text"], "Text")]),
            },
        },
        comment(
            "--- CSRF CONTEXT CHECK ---\n"
            "- Matches checks whether the bootstrap HTML contained a csrf_token"
        ),
        if_start(
            UUID["if_token"],
            100,
            conditional_input(UUID["token_match"], "Matches"),
        ),
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.text.match.getgroup",
            "WFWorkflowActionParameters": {
                "UUID": UUID["token_group"],
                "matches": attachment(UUID["token_match"], "Matches"),
                "WFGroupIndex": 1,
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.setvariable",
            "WFWorkflowActionParameters": {
                "UUID": UUID["csrf_var"],
                "WFVariableName": "CSRF Token",
                "WFInput": attachment(UUID["token_group"], "Group"),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.text.match",
            "WFWorkflowActionParameters": {
                "UUID": UUID["short_match"],
                "WFMatchTextPattern": SHORTCODE_PATTERN,
                "WFMatchTextCaseSensitive": False,
                "text": token_string([output(UUID["first"], "Item from List")]),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.text.match.getgroup",
            "WFWorkflowActionParameters": {
                "UUID": UUID["short_group"],
                "matches": attachment(UUID["short_match"], "Matches"),
                "WFGroupIndex": 1,
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.setvariable",
            "WFWorkflowActionParameters": {
                "UUID": UUID["short_var"],
                "WFVariableName": "Shortcode",
                "WFInput": attachment(UUID["short_group"], "Group"),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.urlencode",
            "WFWorkflowActionParameters": {
                "UUID": UUID["encode"],
                "WFEncodeMode": "Encode",
                "WFInput": attachment(UUID["first"], "Item from List"),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
            "WFWorkflowActionParameters": {
                "UUID": UUID["fallback_url"],
                "WFTextActionText": token_string(
                    [
                        "https://unifetch.pages.dev/share?url=",
                        output(UUID["encode"], "URL Encoded Text"),
                    ]
                ),
            },
        },
        comment("--- FIXED GRAPHQL POST ---"),
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
            "WFWorkflowActionParameters": {
                "UUID": UUID["json_body"],
                "WFTextActionText": token_string(
                    [
                        '{"doc_id":"27128499623469141","variables":{"shortcode":"',
                        variable_attachment("Shortcode"),
                        '","__relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider":false},"server_timestamps":"true"}',
                    ]
                ),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
            "WFWorkflowActionParameters": {
                "UUID": UUID["gql"],
                "WFURL": "https://www.instagram.com/graphql/query",
                "WFHTTPMethod": "POST",
                "WFHTTPHeaders": headers(
                    [
                        header("Accept", "*/*"),
                        header("Accept-Language", "en-US,en;q=0.8"),
                        header("Content-Type", "application/json"),
                        header("X-IG-App-ID", "936619743392459"),
                        header("Referer", "https://www.instagram.com/"),
                        header("User-Agent", UA),
                        header(
                            "X-CSRFToken",
                            token_string([variable_attachment("CSRF Token")]),
                        ),
                        header(
                            "Cookie",
                            token_string(
                                [
                                    "csrftoken=",
                                    variable_attachment("CSRF Token"),
                                ]
                            ),
                        ),
                    ]
                ),
                "WFHTTPBodyType": "File",
                "WFRequestVariable": token_string(
                    [output(UUID["json_body"], "Text")]
                ),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.detect.text",
            "WFWorkflowActionParameters": {
                "UUID": UUID["gql_text"],
                "WFInput": attachment(UUID["gql"], "Contents of URL"),
            },
        },
        comment(
            "--- METADATA RESPONSE CHECK ---\n"
            "- Text checks whether the GraphQL response starts with a JSON object\n"
            "- If it does, the public JSON is copied for the UniFetch Web parser\n"
            "- If it does not, the existing /share Worker flow is opened"
        ),
        if_start(
            UUID["if_json"],
            8,
            conditional_input(UUID["gql_text"], "Text"),
            WFConditionalActionString="{",
        ),
        comment("--- HAND OFF PUBLIC JSON TO THE WEB PARSER ---"),
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.setclipboard",
            "WFWorkflowActionParameters": {
                "UUID": UUID["clip"],
                "WFInput": attachment(UUID["gql_text"], "Text"),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
            "WFWorkflowActionParameters": {
                "UUID": UUID["import_url"],
                "WFTextActionText": token_string(
                    [
                        "https://unifetch.pages.dev/import#url=",
                        output(UUID["encode"], "URL Encoded Text"),
                    ]
                ),
            },
        },
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.openurl",
            "WFWorkflowActionParameters": {
                "UUID": UUID["open"],
                "WFInput": token_string([output(UUID["import_url"], "Text")]),
                "Show-WFInput": True,
            },
        },
        if_else(UUID["if_json"]),
        comment("--- FALLBACK TO THE EXISTING WORKER FLOW ---"),
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.openurl",
            "WFWorkflowActionParameters": {
                "WFInput": token_string(
                    [output(UUID["fallback_url"], "Text")]
                ),
                "Show-WFInput": True,
            },
        },
        if_end(UUID["if_json"]),
        if_else(UUID["if_token"]),
        comment("--- NO CSRF CONTEXT: USE THE EXISTING WORKER FLOW ---"),
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.openurl",
            "WFWorkflowActionParameters": {
                "WFInput": token_string([output(UUID["fallback_url"], "Text")]),
                "Show-WFInput": True,
            },
        },
        if_end(UUID["if_token"]),
        if_else(UUID["if_valid"]),
        alert(
            "UniFetch",
            "UniFetch couldn't find a supported Instagram link in the shared item.",
        ),
        if_end(UUID["if_valid"]),
        if_else(UUID["if_input"]),
        alert(
            "UniFetch",
            "UniFetch couldn't find a supported Instagram link in the shared item.",
        ),
        if_end(UUID["if_input"]),
    ]
    return actions


def build_workflow() -> dict[str, Any]:
    return {
        "WFWorkflowActions": build_actions(),
        "WFWorkflowClientRelease": "18.0",
        "WFWorkflowClientVersion": "1302.1.3",
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowHasShortcutInputVariables": True,
        "WFWorkflowIcon": {
            "WFWorkflowIconGlyphNumber": 61440,
            "WFWorkflowIconStartColor": 4282601983,
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowInputContentItemClasses": [
            "WFURLContentItem",
            "WFTextContentItem",
            "WFSafariWebPageContentItem",
        ],
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowName": "UniFetch L2S Experimental",
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": ["ActionExtension"],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sign", action="store_true")
    args = parser.parse_args()

    workflow = build_workflow()
    with UNSIGNED.open("wb") as handle:
        plistlib.dump(workflow, handle, fmt=plistlib.FMT_XML, sort_keys=False)
    print(f"wrote {UNSIGNED}")

    if not args.sign:
        return 0

    if sys.platform != "darwin":
        print("signing requires macOS", file=sys.stderr)
        return 2

    ARTIFACTS.mkdir(exist_ok=True)
    staging = ARTIFACTS / "UniFetch-L2S-Experimental-unsigned.shortcut"
    staging.write_bytes(UNSIGNED.read_bytes())
    # Apple's signer is more reliable with a binary plist. The community
    # Shortcuts Playground signer retries this way; do the same here.
    subprocess.run(["plutil", "-convert", "binary1", str(staging)], check=True)
    if SIGNED.exists():
        SIGNED.unlink()
    result = subprocess.run(
        [
            "shortcuts",
            "sign",
            "--mode",
            "anyone",
            "--input",
            str(staging),
            "--output",
            str(SIGNED),
        ],
        check=False,
    )
    if result.returncode != 0 or not SIGNED.exists():
        # A transient NSURLErrorDomain 500 has been observed. Retry once.
        result = subprocess.run(
            [
                "shortcuts",
                "sign",
                "--mode",
                "anyone",
                "--input",
                str(staging),
                "--output",
                str(SIGNED),
            ],
            check=False,
        )
    if result.returncode != 0 or not SIGNED.exists():
        print("shortcuts sign failed", file=sys.stderr)
        return result.returncode or 1
    print(f"wrote {SIGNED} ({SIGNED.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
