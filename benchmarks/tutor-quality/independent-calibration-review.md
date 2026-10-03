# Independent board-match calibration review

I reviewed the 24 labels before calls and checked the saved results afterward; this review made no provider calls. [Raw cohort](live-candidate-calibration.json), SHA-256 `99486538a652a3445d7a106768c27acea0e72ce1a43b262d583a23d55f619358`.

The threshold rule was specified before inference. Selection used development domains only, then evaluated three different held-out domains without retuning. At 0.70, each split accepts 2 of 3 correct-target candidates and displays none of its 6 wrong/mixed candidates or 3 insufficiently specific candidates. Across all six incomplete cases, five abstain and one is confidently rejected. At 0.85 and 0.90, every positive is withheld.

The correct 3×5 grid (0.62) and correct chemistry reaction (0.55) still miss. Thus this supports a bounded improvement in activation, not a universal calibrated threshold. Twelve held-out cases are correlated variants within three domains. Generic rules may be useful teaching despite insufficient target identity; mixed negatives assume the learner did not request a comparison. Matching the target does not verify factual correctness or authorize showing its answer.
