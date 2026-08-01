import unittest
from datetime import date

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.models import Account, Transaction
from app.routers.accounts import _base_query, _with_current_balance, update_account
from app.schemas import AccountUpdate


class AccountBalanceTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def test_transfer_into_credit_card_reduces_debt(self):
        async with self.sessions() as db:
            salary = Account(name="工资卡", category="资金账户", balance=100)
            credit = Account(name="信用卡", category="信用卡", balance=-100)
            db.add_all([salary, credit])
            await db.flush()
            db.add(Transaction(
                amount=100,
                type="transfer",
                date=date(2026, 8, 1),
                account_id=salary.id,
                to_account_id=credit.id,
            ))
            await db.commit()

            accounts = (await db.execute(_base_query())).scalars().all()
            result = await _with_current_balance(list(accounts), db)
            by_name = {item["name"]: item for item in result}

            self.assertEqual(by_name["工资卡"]["current_balance"], 0)
            self.assertEqual(by_name["信用卡"]["balance"], -100)
            self.assertEqual(by_name["信用卡"]["current_balance"], 0)

    async def test_editing_credit_initial_balance_replaces_the_old_value(self):
        async with self.sessions() as db:
            credit = Account(name="信用卡", category="信用卡", balance=-15600)
            db.add(credit)
            await db.flush()
            db.add(Transaction(
                amount=1800,
                type="expense",
                date=date(2026, 8, 1),
                account_id=credit.id,
            ))
            await db.commit()

            accounts = (await db.execute(_base_query())).scalars().all()
            before = await _with_current_balance(list(accounts), db)
            self.assertEqual(before[0]["current_balance"], -17400)

            after = await update_account(
                credit.id,
                AccountUpdate(
                    name="信用卡",
                    icon="💳",
                    category="信用卡",
                    balance=-600,
                    member_id=None,
                    note="",
                    sort_order=0,
                    tag_ids=[],
                ),
                db,
            )

            self.assertEqual(after["balance"], -600)
            self.assertEqual(after["current_balance"], -2400)


if __name__ == "__main__":
    unittest.main()
