"""Shared account-balance conventions."""


def normalize_initial_balance(category: str, balance: float) -> float:
    """Store liabilities as negative balances.

    The credit-card form asks for an initial *debt*, so a positive user input
    means money owed and must enter the balance equation as a negative value.
    ``abs`` also keeps legacy positive credit-card balances compatible.
    """
    value = float(balance or 0)
    return -abs(value) if category == "信用卡" else value
