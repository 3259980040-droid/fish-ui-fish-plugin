# Native Fish workspace

The Tasks page separates computer tasks from scheduled messages. Computer tasks use Fish's public DSH Python SDK adapter, dedicated task home/workspace, and a background worker independent of chat. The page displays execution and output availability separately. Download reads a task's verified attachment bytes; a displayed path or model response is not a file delivery. Stop requests remain pending until the local runtime closes; unknown outcomes are never retried automatically. QQ file delivery and natural-language task routing are outside this increment.

Local ordinary chat uses Fish's configured API and selected persona, independently of DSH Session execution. Existing work-mode sessions retain their previous route. Delivery polling settles on complete, failed, or cancelled, and refreshes the saved message status. Submission ids prevent a transport retry from creating a second job; cancellation closes local waiting without claiming that the provider stopped computing.

The settings page separates model thinking, reply display, and the per-turn tool allowance (zero means unlimited). Channels show the effective normal or test route and let the owner edit community context shared by both routes. Long replies use the existing segmented QQ delivery path; generated memory keeps its evidence type and source message.

Character identification can extract visual features, search and read sources, and rank candidates using configurable feature weights. The settings page exposes its enable switch. Scores represent source matching, not identity probabilities; owner-confirmed exact images bypass speculative lookup.
