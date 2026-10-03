# Independent Sol architecture review

NO_COMPLETE_ROW_IMPROVEMENT_ARCHITECTURE_CHANGE_REQUIRED; no adoption. Diagnostic disposition only; formal54/9 remains HOLD.

All architectures yield zero complete rows. Partial-header reconstruction trades fewer unaligned predictions for lower coverage and purchase accuracy versus Frozen general. Header fuzziness and page segmentation changes increase tokens or rows without reliable names. Existing P6 is rejected.

Observed limits: dedicated fixed row lattice; general nearest-header assignment and amount heuristics; P5 incomplete header anchors and token row clustering. These observations do not isolate physical causes for individual scoring misses. Unmatched rows are scoring observations, not verified physical false positives.

Next design proposal: dictionary-free document-local geometry, uncertain spatial row/column association, field recognition and abstention as separately measured stages. Obtain independent geometry annotations and separately sourced development photos before implementing against formal evaluation. Preserve inherited dictionary for historical baseline reproduction only. Node Skia source-equivalent execution is not browser parity.
