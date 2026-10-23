import { describe, expect, it } from 'vitest';
import type { StoryFeasibilityResult } from './contracts';
import { storyFeasibilityDiagnostic } from './diagnostic';

describe('Story feasibility identity diagnostic formatter', () => {
  it('prints every identity-integrity field on a username-only route', () => {
    const result: StoryFeasibilityResult = {
      status: 'SUCCESS',
      httpStatus: 200,
      responseKind: 'JSON',
      itemCount: 1,
      assetTypes: ['image'],
      acquisitionContext: 'background',
      storySource: 'current-id-page-state',
      idExtractionSource: 'viewer-attribute',
      candidateCount: 1,
      activeMarkerFound: true,
      activeRoot: 'proven',
      candidateInsideActiveRoot: true,
      routeOwnerMatch: 'unknown',
      responseOwnerMatch: true,
      identityResult: 'proven',
    };
    const text = storyFeasibilityDiagnostic(result);
    expect(text).toContain('activeRoot=proven');
    expect(text).toContain('id=viewer-attribute');
    expect(text).toContain('cand=1');
    expect(text).toContain('activeMarker=true');
    expect(text).toContain('insideRoot=true');
    expect(text).toContain('routeOwnerMatch=unknown');
    expect(text).toContain('responseOwnerMatch=true');
    expect(text).toContain('identity=proven');
  });

  it('prints unproven/mismatch states without leaking identity', () => {
    const result: StoryFeasibilityResult = {
      status: 'UNSUPPORTED_CONTENT',
      acquisitionContext: 'background',
      storySource: 'current-id-page-state',
      idExtractionSource: 'none',
      candidateCount: 'many',
      activeMarkerFound: false,
      activeRoot: 'ambiguous',
      candidateInsideActiveRoot: 'unknown',
      routeOwnerMatch: false,
      responseOwnerMatch: 'unknown',
      identityResult: 'mismatch',
    };
    const text = storyFeasibilityDiagnostic(result);
    expect(text).toContain('activeRoot=ambiguous');
    expect(text).toContain('cand=many');
    expect(text).toContain('insideRoot=unknown');
    expect(text).toContain('routeOwnerMatch=false');
    expect(text).toContain('responseOwnerMatch=unknown');
    expect(text).toContain('identity=mismatch');
    expect(text).not.toContain('httpStatus');
    expect(text).not.toContain('@');
    expect(text).not.toContain('http');
  });

  it('omits absent identity fields instead of printing undefined', () => {
    const text = storyFeasibilityDiagnostic({ status: 'LOGIN_REQUIRED' });
    expect(text).toBe('LOGIN_REQUIRED');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('identity=');
  });

  it('prints sanitized per-source id evidence without leaking values', () => {
    const result: StoryFeasibilityResult = {
      status: 'UNSUPPORTED_CONTENT',
      storySource: 'current-id-page-state',
      idExtractionSource: 'none',
      candidateCount: 'many',
      activeMarkerFound: false,
      activeRoot: 'proven',
      candidateInsideActiveRoot: true,
      idEvidence: [
        {
          source: 'html-inline-json',
          candidateCount: 0,
          strongCandidateCount: 0,
          activeCandidateCount: 0,
          insideActiveRoot: 'n/a',
        },
        {
          source: 'react-current-props',
          candidateCount: 0,
          strongCandidateCount: 0,
          activeCandidateCount: 0,
          insideActiveRoot: true,
          react: {
            reactKeyFound: true,
            descendantReactKeyFound: true,
            inspectedNodeKinds: ['media', 'descendant'],
            candidateKeyNames: ['media_id'],
            candidatePathShapes: ['current.media.mediaId', 'user.pk'],
            candidateDepths: [-1],
            objectShapeHints: ['media', 'story'],
          },
        },
      ],
    };
    const text = storyFeasibilityDiagnostic(result);
    expect(text).toContain('ev=');
    expect(text).toContain('src=html-inline-json');
    expect(text).toContain('inside=n/a');
    expect(text).toContain('src=react-current-props');
    expect(text).toContain('reactKey=true');
    expect(text).toContain('descKey=true');
    expect(text).toContain('nodes=media,descendant');
    expect(text).toContain('keys=media_id');
    expect(text).toContain('paths=current.media.mediaId,user.pk');
    expect(text).toContain('depths=-1');
    expect(text).toContain('shapes=media,story');
    expect(text).not.toContain('http');
    expect(text).not.toContain('@');
  });

  it('prints sanitized identity-source structure without leaking values', () => {
    const result: StoryFeasibilityResult = {
      status: 'UNSUPPORTED_CONTENT',
      storySource: 'current-id-page-state',
      activeRoot: 'proven',
      candidateInsideActiveRoot: true,
      identityResult: 'unproven',
      identitySources: {
        fiber: {
          root: true,
          parentDepths: [0, 1, 2],
          propKeys: ['?', 'current', 'mediaId'],
          stateKeys: ['?'],
          handlerKeys: ['onClick'],
          childKinds: ['function', 'host'],
          childCount: 2,
          candidatePathShapes: ['current.media.mediaId'],
        },
        links: {
          storyItemShape: true,
          reelShape: false,
          postShape: false,
          otherShape: true,
        },
        nav: { navigationApi: true, entryStateKeys: ['mediaId'] },
        mediaMeta: {
          datasetKeys: ['?'],
          attributeKeys: ['src', 'poster'],
          sourceAttributeKeys: ['src'],
          trackAttributeKeys: [],
          sourceCount: 1,
          trackCount: 0,
        },
        store: {
          found: true,
          shapeKeys: ['?', 'current'],
          candidatePathShapes: ['current.media.mediaId'],
        },
      },
    };
    const text = storyFeasibilityDiagnostic(result);
    expect(text).toContain('idSrc=');
    expect(text).toContain('[fiber root=true parents=0,1,2 children=2');
    expect(text).toContain('propKeys=?,current,mediaId');
    expect(text).toContain('handlers=onClick');
    expect(text).toContain('childKinds=function,host');
    expect(text).toContain('paths=current.media.mediaId');
    expect(text).toContain(
      '[links storyItem=true reel=false post=false other=true]',
    );
    expect(text).toContain('[nav api=true stateKeys=mediaId]');
    expect(text).toContain(
      '[mediaMeta dataset=? attrs=src,poster sourceAttrs=src trackAttrs=none sources=1 tracks=0]',
    );
    expect(text).toContain(
      '[store found=true keys=?,current paths=current.media.mediaId]',
    );
    expect(text).not.toContain('http');
    expect(text).not.toContain('@');
    expect(text).not.toContain('1234567890');
  });
});
