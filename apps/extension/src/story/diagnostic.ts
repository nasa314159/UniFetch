import type {
  StoryFeasibilityResult,
  StoryIdSourceDiagnostic,
  StoryIdentitySourceDiagnostic,
} from './contracts';

function describeTimestamps(result: StoryFeasibilityResult): string {
  return (result.timestampSources ?? [])
    .map((source) =>
      source.approximateDeltaFromNowMinutes !== undefined
        ? `${source.fieldName}:${source.semanticKind}(${source.approximateDeltaFromNowMinutes}m)`
        : `${source.fieldName}:${source.semanticKind}`,
    )
    .join(', ');
}

/**
 * Sanitized per-source id-evidence line. It prints only structural facts:
 * source name, none/one/many counts, root scoping, and React node KIND labels,
 * candidate KEY NAMES, relative depths and property-name shape hints. It never
 * prints a numeric id, prop value, URL or username.
 */
function describeIdEvidence(list: readonly StoryIdSourceDiagnostic[]): string {
  return list
    .map((item) => {
      const base = `src=${item.source} cand=${item.candidateCount} strong=${item.strongCandidateCount} active=${item.activeCandidateCount} inside=${item.insideActiveRoot}`;
      if (!item.react) return `[${base}]`;
      const react = item.react;
      const nodes = react.inspectedNodeKinds.length
        ? react.inspectedNodeKinds.join(',')
        : 'none';
      const keys = react.candidateKeyNames.length
        ? react.candidateKeyNames.join(',')
        : 'none';
      const paths = react.candidatePathShapes?.length
        ? react.candidatePathShapes.join(',')
        : 'none';
      const depths = react.candidateDepths.length
        ? react.candidateDepths.join(',')
        : 'none';
      const shapes = react.objectShapeHints.length
        ? react.objectShapeHints.join(',')
        : 'none';
      return `[${base} reactKey=${react.reactKeyFound} descKey=${react.descendantReactKeyFound} nodes=${nodes} keys=${keys} paths=${paths} depths=${depths} shapes=${shapes}]`;
    })
    .join(' ');
}

/**
 * Sanitized observation-only identity-source line. It prints only structure:
 * booleans, counts, relative depths, generic kind labels and sanitized key
 * NAMES / path shapes. It never prints a numeric id, value, URL or username.
 */
function describeIdentitySources(
  sources: StoryIdentitySourceDiagnostic,
): string {
  const parts: string[] = [];
  if (sources.fiber) {
    const fiber = sources.fiber;
    const list = (values: readonly (string | number)[]): string =>
      values.length ? values.join(',') : 'none';
    parts.push(
      `[fiber root=${fiber.root} parents=${list(fiber.parentDepths)} children=${fiber.childCount} propKeys=${list(fiber.propKeys)} stateKeys=${list(fiber.stateKeys)} handlers=${list(fiber.handlerKeys)} childKinds=${list(fiber.childKinds)} paths=${list(fiber.candidatePathShapes)}]`,
    );
  }
  if (sources.links) {
    const links = sources.links;
    parts.push(
      `[links storyItem=${links.storyItemShape} reel=${links.reelShape} post=${links.postShape} other=${links.otherShape}]`,
    );
  }
  if (sources.nav) {
    const nav = sources.nav;
    parts.push(
      `[nav api=${nav.navigationApi} stateKeys=${nav.entryStateKeys.length ? nav.entryStateKeys.join(',') : 'none'}]`,
    );
  }
  if (sources.mediaMeta) {
    const meta = sources.mediaMeta;
    const list = (values: readonly string[]): string =>
      values.length ? values.join(',') : 'none';
    parts.push(
      `[mediaMeta dataset=${list(meta.datasetKeys)} attrs=${list(meta.attributeKeys)} sourceAttrs=${list(meta.sourceAttributeKeys)} trackAttrs=${list(meta.trackAttributeKeys)} sources=${meta.sourceCount} tracks=${meta.trackCount}]`,
    );
  }
  if (sources.store) {
    const store = sources.store;
    parts.push(
      `[store found=${store.found} keys=${store.shapeKeys.length ? store.shapeKeys.join(',') : 'none'} paths=${store.candidatePathShapes.length ? store.candidatePathShapes.join(',') : 'none'}]`,
    );
  }
  return parts.join(' ');
}

/**
 * Sanitized single-line Story feasibility diagnostic. On a username-only route
 * it always prints the identity-integrity fields (activeRoot, id, cand,
 * insideRoot, routeOwnerMatch, responseOwnerMatch, identity) so a stale bundle
 * becomes visible immediately. It never prints an id, username or URL.
 */
export function storyFeasibilityDiagnostic(
  result: StoryFeasibilityResult,
): string {
  const parts: string[] = [result.status];
  if (result.httpStatus !== undefined) parts.push(`HTTP ${result.httpStatus}`);
  if (result.responseKind) parts.push(result.responseKind);
  if (result.itemCount !== undefined) parts.push(`${result.itemCount} item(s)`);
  if (result.assetTypes?.length) parts.push(result.assetTypes.join('/'));
  if (result.acquisitionContext) parts.push(result.acquisitionContext);
  if (result.storySource) parts.push(result.storySource);
  if (result.idExtractionSource) parts.push(`id=${result.idExtractionSource}`);
  if (result.candidateCount !== undefined)
    parts.push(`cand=${result.candidateCount}`);
  if (result.activeMarkerFound !== undefined)
    parts.push(`activeMarker=${result.activeMarkerFound}`);
  if (result.idEvidence?.length)
    parts.push(`ev=${describeIdEvidence(result.idEvidence)}`);
  if (result.activeRoot) parts.push(`activeRoot=${result.activeRoot}`);
  if (result.candidateInsideActiveRoot !== undefined)
    parts.push(`insideRoot=${result.candidateInsideActiveRoot}`);
  if (result.routeOwnerMatch !== undefined)
    parts.push(`routeOwnerMatch=${result.routeOwnerMatch}`);
  if (result.responseOwnerMatch !== undefined)
    parts.push(`responseOwnerMatch=${result.responseOwnerMatch}`);
  if (result.identityResult) parts.push(`identity=${result.identityResult}`);
  if (result.identitySources) {
    const identity = describeIdentitySources(result.identitySources);
    if (identity) parts.push(`idSrc=${identity}`);
  }
  if (result.mseSource) parts.push(`mse=${result.mseSource}`);
  if (result.audioPresent !== undefined)
    parts.push(`audio=${result.audioPresent}`);
  if (result.mseReason) parts.push(result.mseReason);
  if (result.visibleMedia) parts.push(result.visibleMedia);
  if (result.viewerShape) parts.push(result.viewerShape);
  const timestamps = describeTimestamps(result);
  if (timestamps) parts.push(`ts=${timestamps}`);
  return parts.join(' · ');
}
