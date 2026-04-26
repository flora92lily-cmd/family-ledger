"""初始化默认分类（全新安装时执行）。家庭成员由用户自行在设置页创建。"""
from sqlalchemy import select
from app.models import Category

DEFAULT_CATEGORIES = [
    # 支出分类
    {"name": "餐饮", "icon": "🍜", "type": "expense", "keywords": "美团,饿了么,餐厅,食堂,早餐,午餐,晚餐,外卖,肯德基,麦当劳,星巴克,瑞幸"},
    {"name": "交通", "icon": "🚗", "type": "expense", "keywords": "滴滴,打车,地铁,公交,加油,停车,高速,出租车,共享单车"},
    {"name": "购物", "icon": "🛒", "type": "expense", "keywords": "淘宝,京东,拼多多,天猫,超市,商场"},
    {"name": "居住", "icon": "🏠", "type": "expense", "keywords": "房租,房贷,物业,水费,电费,燃气,暖气"},
    {"name": "医疗", "icon": "🏥", "type": "expense", "keywords": "医院,药店,挂号,体检"},
    {"name": "教育", "icon": "📚", "type": "expense", "keywords": "学费,培训,课程,书"},
    {"name": "娱乐", "icon": "🎮", "type": "expense", "keywords": "电影,游戏,KTV,旅游,门票"},
    {"name": "通讯", "icon": "📱", "type": "expense", "keywords": "话费,流量,宽带"},
    {"name": "服饰", "icon": "👔", "type": "expense", "keywords": "衣服,鞋,包"},
    {"name": "人情", "icon": "🎁", "type": "expense", "keywords": "红包,礼物,份子钱,转账"},
    {"name": "其他支出", "icon": "💰", "type": "expense", "keywords": ""},
    # 收入分类
    {"name": "工资", "icon": "💵", "type": "income", "keywords": "工资,薪资"},
    {"name": "奖金", "icon": "🏆", "type": "income", "keywords": "奖金,年终奖,绩效"},
    {"name": "理财", "icon": "📈", "type": "income", "keywords": "利息,股息,基金,收益"},
    {"name": "红包", "icon": "🧧", "type": "income", "keywords": "红包"},
    {"name": "其他收入", "icon": "💎", "type": "income", "keywords": ""},
]


async def seed_defaults(db):
    """如果数据库为空，插入默认数据"""
    # 检查是否已有分类
    result = await db.execute(select(Category).limit(1))
    if result.scalar():
        return  # 已有数据，跳过

    # 插入默认分类
    for cat_data in DEFAULT_CATEGORIES:
        db.add(Category(**cat_data))

    await db.commit()
