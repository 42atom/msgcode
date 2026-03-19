# Doc Filename Migration Review

## Summary

- issues rename map: 184
- plan docs rename map: 172
- research docs rename map: 16
- linked plan docs reused issue id: 168
- linked research docs reused issue id: 5
- board review needed: 16
- active task priority review needed: 24
- delete candidates under vendor/build archive: 38

## Confirmed Decisions

- merge `docs/design/` and `docs/notes/` into `docs/plan/`
- allow deletion of `docs/archive/retired-desktop-bridge/mac/msgcode-desktopctl/.build/checkouts/**`
- completed tasks do not get `prio`; only active tasks may receive `p0/p1/p2`
- unlinked historical plan/research docs use `9000+` id range

## Manual Review

### Active Tasks Missing Priority

- issues/0003-feishu-ws-transport-default-workspace.md -> issues/tk0003.doi.feishu.feishu-ws-transport-default-workspace.md
- issues/0009-unix-mainline-refactor.md -> issues/tk0009.doi.agent.unix-mainline-refactor.md
- issues/0011-feishu-send-file-runtime-context.md -> issues/tk0011.doi.feishu.feishu-send-file-runtime-context.md
- issues/0012-feishu-inbound-attachments-and-channel-provider-boundary.md -> issues/tk0012.doi.feishu.feishu-inbound-attachments-and-channel-provider-boundary.md
- issues/tk0021.pss.agent.p2.prompt-message-stratification-experiment.md -> issues/tk0021.tdo.agent.prompt-message-stratification-experiment.md
- issues/0027-llm-skill-directory-open-loop.md -> issues/tk0027.doi.agent.llm-skill-directory-open-loop.md
- issues/tk0034.pss.schedule.p0.schedule-stop-workspace-and-projection-sync.md -> issues/tk0034.tdo.schedule.schedule-stop-workspace-and-projection-sync.md
- issues/tk0035.pss.schedule.p0.schedule-cli-contract-and-delete-consistency.md -> issues/tk0035.tdo.schedule.schedule-cli-contract-and-delete-consistency.md
- issues/0036-openclaw-tool-loop-alignment.md -> issues/tk0036.tdo.agent.openclaw-tool-loop-alignment.md
- issues/0037-openclaw-direct-tool-loop-port.md -> issues/tk0037.tdo.agent.openclaw-direct-tool-loop-port.md
- issues/0054-vision-detail-skill-first-provider-neutral.md -> issues/tk0054.doi.model.vision-detail-skill-first-provider-neutral.md
- issues/0055-local-model-load-retry.md -> issues/tk0055.doi.runtime.local-model-load-retry.md
- issues/0065-post-imessage-channel-strategy.md -> issues/tk0065.tdo.feishu.post-imessage-channel-strategy.md
- issues/0066-openclaw-agent-core-gap-analysis.md -> issues/tk0066.doi.agent.openclaw-agent-core-gap-analysis.md
- issues/0067-ghost-os-desktop-plugin-replacement.md -> issues/tk0067.pss.ghost.p1.ghost-os-desktop-plugin-replacement.md
- issues/0071-skill-layering-and-conflict-policy-review.md -> issues/tk0071.tdo.docs.skill-layering-and-conflict-policy-review.md
- issues/tk0094.pss.ghost.p2.heavy-resource-admission-mvp.md -> issues/tk0094.pss.ghost.p2.heavy-resource-admission-mvp.md
- issues/0097-runtime-skill-wrapper-slimming.md -> issues/tk0097.doi.runtime.runtime-skill-wrapper-slimming.md
- issues/0103-ai-os-foundation-roadmap.md -> issues/tk0103.tdo.product.ai-os-foundation-roadmap.md
- issues/0131-browser-text-artifact-and-skill-contract.md -> issues/tk0131.doi.browser.browser-text-artifact-and-skill-contract.md
- issues/0165-chromium-cookie-export-cli.md -> issues/tk0165.tdo.browser.chromium-cookie-export-cli.md
- issues/0180-ghost-permission-host-facts-and-error-diagnostics.md -> issues/tk0180.doi.runtime.ghost-permission-host-facts-and-error-diagnostics.md
- issues/0181-ghost-permission-preflight-and-auto-open.md -> issues/tk0181.doi.runtime.ghost-permission-preflight-and-auto-open.md
- issues/0182-desktop-permissions-preauth-on-daemon-start.md -> issues/tk0182.doi.runtime.desktop-permissions-preauth-on-daemon-start.md

### Board Needs Review

- issues/0045-cleanup-simplification-program.md -> issues/tk0045.dne.runtime.cleanup-simplification-program.md (default:runtime)
- issues/0068-character-identity-skill-for-multi-speaker-chat.md -> issues/tk0068.dne.runtime.character-identity-skill-for-multi-speaker-chat.md (default:runtime)
- issues/0076-legacy-active-skills-and-artifact-path-cleanup.md -> issues/tk0076.dne.runtime.legacy-active-skills-and-artifact-path-cleanup.md (default:runtime)
- issues/0078-skill-self-contained-distribution-rule.md -> issues/tk0078.dne.runtime.skill-self-contained-distribution-rule.md (default:runtime)
- issues/0083-merge-prep-worktree-cleanup.md -> issues/tk0083.dne.runtime.merge-prep-worktree-cleanup.md (default:runtime)
- issues/0102-llm-execution-authority-charter.md -> issues/tk0102.dne.runtime.llm-execution-authority-charter.md (default:runtime)
- issues/0171-release-version-bump-to-2-4-0.md -> issues/tk0171.dne.runtime.release-version-bump-to-2-4-0.md (default:runtime)
- issues/0173-stop-tracking-trash-directory.md -> issues/tk0173.dne.runtime.stop-tracking-trash-directory.md (default:runtime)
- issues/0176-stop-tracking-manual-artifacts.md -> issues/tk0176.dne.runtime.stop-tracking-manual-artifacts.md (default:runtime)
- docs/design/plan-260223-r10-identity-layer-local-first.md -> docs/plan/pl9000.dne.runtime.r10-identity-layer-local-first.md (default:runtime)
- docs/design/plan-260312-idle-reflection-skill-improvement.md -> docs/plan/pl9003.dne.runtime.idle-reflection-skill-improvement.md (default:runtime)
- docs/notes/research-260306-msgcode-architecture.md -> docs/plan/rs9001.dne.docs.msgcode-architecture.md (default:docs)
- docs/notes/research-260310-character-identity-skill.md -> docs/plan/rs9003.dne.docs.character-identity-skill.md (default:docs)
- docs/notes/research-260310-mobile-entry-options.md -> docs/plan/rs9005.dne.docs.mobile-entry-options.md (default:docs)
- docs/notes/research-260310-thin-core-plugin-topology.md -> docs/plan/rs9008.dne.docs.thin-core-plugin-topology.md (default:docs)
- docs/notes/research-260310-transparent-execution-plugin.md -> docs/plan/rs9009.dne.docs.transparent-execution-plugin.md (default:docs)

## Output Files

- `AIDOCS/reports/active/doc-filename-migration/rename-map.tsv`
- `AIDOCS/reports/active/doc-filename-migration/delete-candidates.txt`
- `AIDOCS/reports/active/doc-filename-migration/review.md`
