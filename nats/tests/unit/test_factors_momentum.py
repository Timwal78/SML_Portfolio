import pandas as pd

from src.factors.momentum import mom_5d


def test_mom_5d_is_shifted_by_one_bar():
    close = pd.Series([100, 101, 102, 103, 104, 110, 111], dtype=float)
    result = mom_5d(close)
    unshifted = close.pct_change(5)
    # result[t] should equal unshifted[t-1]
    pd.testing.assert_series_equal(
        result.iloc[1:].reset_index(drop=True),
        unshifted.iloc[:-1].reset_index(drop=True),
        check_names=False,
    )
    assert pd.isna(result.iloc[0])
