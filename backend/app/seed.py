"""初始化默认分类（全新安装时执行）。

分类结构来源：用户自定义的"支出类别"和"收入类别"两张表（去掉字母前缀和待定项）。

设计要点：
- 两层结构：父分类（如"日常生活"）→ 子分类（如"三餐"），用 parent_id 关联
- 父分类 keywords 一律留空，不参与智能匹配（避免与子分类竞争）
- 子分类 keywords 只服务支付宝/微信/银行 PDF/通用 CSV 这几种导入
- 钱迹导入直接按分类名查 Category 表，命中就用，命中不到才走关键词
- 留空 keywords 的子分类（差旅、工资-头/腾、公积金-头/腾、历史账目、其他收入等）
  导入时不会自动归类，需要用户手动选
- 兜底：导入时找不到任何匹配的支出 → "其他支出"；收入 → "退款报销→其他收入"
"""
from sqlalchemy import select
from app.models import Category


EXPENSE_TREE = [
    {
        "name": "日常生活", "icon": "🏠",
        "children": [
            {"name": "三餐", "icon": "🍚", "keywords": "餐厅,饭店,外卖,美团,饿了么,午餐,晚餐,早餐,麦当劳,肯德基,星巴克,咖啡,奶茶,喜茶,瑞幸,火锅,烧烤,食堂"},
            {"name": "日用消耗", "icon": "🧻", "keywords": "卫生纸,纸巾,洗发水,沐浴露,牙膏,牙刷,洗衣液,洗洁精,日化,清洁"},
            {"name": "零食", "icon": "🍪", "keywords": "薯片,饼干,巧克力,坚果,便利蜂,711,全家,蜜雪冰城"},
            {"name": "家具家电", "icon": "🛋️", "keywords": "家具,家电,沙发,冰箱,洗衣机,空调,电视,宜家,IKEA,小米有品"},
            {"name": "家居杂货", "icon": "🪴", "keywords": "家居,杂货,收纳,装饰,日杂"},
            {"name": "家政", "icon": "🧹", "keywords": "家政,保洁,阿姨,搬家"},
            {"name": "美发", "icon": "💇", "keywords": "理发,美发,剪发,发廊,造型"},
            {"name": "快递", "icon": "📦", "keywords": "快递,顺丰,圆通,中通,韵达,京东物流,菜鸟驿站,邮费"},
            {"name": "烘焙材料", "icon": "🧁", "keywords": "烘焙,面粉,黄油,奶油,烘焙模具"},
        ],
    },
    {
        "name": "固定开支", "icon": "🧾",
        "children": [
            {"name": "话费", "icon": "📱", "keywords": "话费,流量,移动,联通,电信,充话费"},
            {"name": "水费", "icon": "💧", "keywords": "水费,自来水"},
            {"name": "电费", "icon": "💡", "keywords": "电费,国家电网,供电"},
            {"name": "燃气", "icon": "🔥", "keywords": "燃气,天然气,煤气"},
            {"name": "取暖费", "icon": "🌡️", "keywords": "取暖,供暖,暖气"},
            {"name": "物业费", "icon": "🏢", "keywords": "物业,物业费"},
            {"name": "房贷", "icon": "🏘️", "keywords": "房贷,按揭"},
            {"name": "车位费", "icon": "🅿️", "keywords": "车位"},
            {"name": "房租", "icon": "🏠", "keywords": "房租,租房,租金"},
            {"name": "党费", "icon": "🚩", "keywords": "党费"},
            {"name": "网费", "icon": "🌐", "keywords": "网费,宽带"},
        ],
    },
    {
        "name": "交通出行", "icon": "🚗",
        "children": [
            {"name": "打车", "icon": "🚕", "keywords": "滴滴,出租车,网约车,曹操,T3,首汽,享道"},
            {"name": "公共交通", "icon": "🚇", "keywords": "地铁,公交,公共交通"},
            {"name": "充电", "icon": "🔌", "keywords": "充电,充电桩,特来电,星星充电"},
            {"name": "油费", "icon": "⛽", "keywords": "加油,中石油,中石化,壳牌"},
            {"name": "停车费", "icon": "🅿️", "keywords": "停车场,停车费"},
            {"name": "洗车", "icon": "🧼", "keywords": "洗车"},
            {"name": "过路费", "icon": "🛣️", "keywords": "高速,过路费,ETC,通行费"},
            {"name": "汽车罚款", "icon": "🚓", "keywords": "违章,交通罚款"},
            {"name": "维修保养", "icon": "🔧", "keywords": "保养,4S店,汽修,汽车维修"},
            {"name": "配件", "icon": "⚙️", "keywords": "汽车配件,轮胎,机油,雨刮"},
            {"name": "车险", "icon": "🛡️", "keywords": "车险"},
            {"name": "火车", "icon": "🚄", "keywords": "高铁,火车,12306,动车,铁路"},
            {"name": "飞机", "icon": "✈️", "keywords": "机票,航班,东航,国航,南航,海航,春秋,航空"},
        ],
    },
    {
        "name": "休闲娱乐", "icon": "🎮",
        "children": [
            {"name": "彩票", "icon": "🎫", "keywords": "彩票,体彩,福彩,双色球,大乐透"},
            {"name": "聚会", "icon": "🍻", "keywords": "聚餐,KTV,酒吧,清吧"},
            {"name": "麻将德州", "icon": "🀄", "keywords": "麻将,德州,棋牌"},
            {"name": "游戏", "icon": "🎮", "keywords": "Steam,腾讯游戏,网易游戏,游戏充值"},
            {"name": "会员", "icon": "👑", "keywords": "腾讯视频,爱奇艺,优酷,B站,Bilibili,Netflix,Spotify,iCloud,百度网盘,会员"},
            {"name": "运动健身", "icon": "💪", "keywords": "健身,健身房,瑜伽,游泳,Keep"},
            {"name": "电影", "icon": "🎬", "keywords": "电影票,影院,万达影城,IMAX,猫眼,淘票票"},
            {"name": "塔罗算命", "icon": "🔮", "keywords": "塔罗,算命,占卜"},
        ],
    },
    {
        "name": "服饰美妆", "icon": "👗",
        "children": [
            {"name": "鞋服", "icon": "👔", "keywords": "衣服,鞋,服装,优衣库,Zara,H&M,Nike,Adidas,外套,T恤,裤子"},
            {"name": "护肤品", "icon": "🧴", "keywords": "护肤,面膜,精华,水乳,洁面,SK-II,雅诗兰黛,兰蔻"},
            {"name": "化妆品", "icon": "💄", "keywords": "化妆品,口红,粉底,眼影,Mac,完美日记,花西子"},
            {"name": "饰品", "icon": "💍", "keywords": "饰品,首饰,项链,耳环,戒指,手链"},
        ],
    },
    {
        "name": "医疗保健", "icon": "🏥",
        "children": [
            {"name": "就诊", "icon": "🏥", "keywords": "医院,门诊,挂号,诊所"},
            {"name": "药品", "icon": "💊", "keywords": "药店,大药房,药房"},
            {"name": "保健品", "icon": "🍯", "keywords": "保健品,维生素,蛋白粉,鱼油,钙片"},
            {"name": "保健", "icon": "💆", "keywords": "按摩,推拿,理疗,中医,针灸,SPA"},
            {"name": "产检", "icon": "🤰", "keywords": "产检,孕检,妇幼"},
            {"name": "保险", "icon": "🛡️", "keywords": "人寿,重疾,医疗险,保费"},
        ],
    },
    {
        "name": "学习办公", "icon": "📚",
        "children": [
            {"name": "书籍", "icon": "📖", "keywords": "当当,京东图书,kindle,电子书,图书"},
            {"name": "课程", "icon": "🎓", "keywords": "网课,得到,知乎课,在线课,培训课"},
            {"name": "工具", "icon": "🛠️", "keywords": "Notion,印象笔记,Office,Adobe,软件订阅"},
            {"name": "考试", "icon": "📝", "keywords": "考试,报名费,考研,雅思,托福,四六级"},
            {"name": "电子产品", "icon": "💻", "keywords": "电脑,iPad,iPhone,平板,耳机,键盘,鼠标,显示器,数码"},
            {"name": "学费", "icon": "🏫", "keywords": "学费,学杂费,书本费"},
        ],
    },
    {
        "name": "四脚神兽", "icon": "👶",
        "children": [
            {"name": "婴儿用品", "icon": "👶", "keywords": "婴儿,宝宝用品"},
            {"name": "奶粉", "icon": "🍼", "keywords": "奶粉"},
            {"name": "医疗", "icon": "🏥", "keywords": "儿童医院,小儿,儿科,儿保"},
            {"name": "纸尿裤", "icon": "🧷", "keywords": "纸尿裤,尿不湿,帮宝适,花王"},
            {"name": "婴儿服", "icon": "👕", "keywords": "童装,宝宝衣服,婴儿服"},
            {"name": "玩具", "icon": "🧸", "keywords": "玩具,乐高,玩具车,毛绒玩具,手办"},
            {"name": "疫苗", "icon": "💉", "keywords": "疫苗,接种"},
            {"name": "辅食", "icon": "🥣", "keywords": "辅食,米粉,果泥"},
            {"name": "绘本", "icon": "📚", "keywords": "绘本,童书"},
            {"name": "户外娱乐", "icon": "🎠", "keywords": "游乐场,儿童乐园,亲子"},
            {"name": "牛奶", "icon": "🥛", "keywords": "牛奶,鲜奶"},
            {"name": "宝宝零食", "icon": "🍭", "keywords": "宝宝零食,儿童零食,泡芙"},
            {"name": "早教", "icon": "👨‍🏫", "keywords": "早教,亲子课,蒙特梭利"},
        ],
    },
    {
        "name": "旅行度假", "icon": "🌴",
        "children": [
            {"name": "旅行交通", "icon": "🚄", "keywords": ""},
            {"name": "旅游住宿", "icon": "🏨", "keywords": "酒店,民宿,booking,携程,airbnb,爱彼迎,亚朵,如家"},
            {"name": "旅游餐饮", "icon": "🍽️", "keywords": ""},
            {"name": "旅游购物", "icon": "🛍️", "keywords": ""},
            {"name": "景区门票", "icon": "🎫", "keywords": "景区,门票,景点"},
            {"name": "娱乐项目", "icon": "🎢", "keywords": "海洋馆,动物园,游乐园,迪士尼,环球影城"},
            {"name": "导游团费", "icon": "🧑‍✈️", "keywords": "导游,团费,旅行团"},
        ],
    },
    {
        "name": "金融理财", "icon": "📊",
        "children": [
            {"name": "基金亏损", "icon": "📉", "keywords": "基金亏损"},
            {"name": "股票亏损", "icon": "📉", "keywords": "股票亏损"},
            {"name": "投资亏损", "icon": "📉", "keywords": "投资亏损"},
            {"name": "平账", "icon": "⚖️", "keywords": "平账"},
            {"name": "手续费", "icon": "💸", "keywords": "手续费,服务费"},
        ],
    },
    {
        "name": "差旅出行", "icon": "💼",
        "children": [
            {"name": "酒店住宿", "icon": "🏨", "keywords": ""},
            {"name": "交通", "icon": "🚇", "keywords": ""},
            {"name": "打车", "icon": "🚕", "keywords": ""},
        ],
    },
    {
        "name": "人情往来", "icon": "🎁",
        "children": [
            {"name": "孝敬长辈", "icon": "👴", "keywords": "孝敬,赡养"},
            {"name": "礼金", "icon": "💰", "keywords": "礼金,份子钱,随礼"},
            {"name": "礼物", "icon": "🎁", "keywords": "生日礼物,送礼,礼物"},
            {"name": "捐赠慈善", "icon": "💝", "keywords": "捐赠,慈善,捐款,公益"},
            {"name": "发红包", "icon": "🧧", "keywords": "微信红包,发红包"},
            {"name": "压岁钱", "icon": "🧧", "keywords": "压岁钱,过年红包"},
        ],
    },
    {
        "name": "大事专项", "icon": "🎉",
        "children": [
            {"name": "装修", "icon": "🔨", "keywords": "装修,建材,瓷砖,涂料,油漆,水电改造,木工"},
            {"name": "婚礼", "icon": "💒", "keywords": "婚礼,婚宴,婚纱,婚庆,蜜月,婚戒"},
            {"name": "历史账目", "icon": "📜", "keywords": ""},
            {"name": "月子中心", "icon": "🤱", "keywords": "月子,月嫂,月子中心,产后"},
        ],
    },
    {
        "name": "公司投入", "icon": "🏢",
        "children": [
            {"name": "投资款", "icon": "💵", "keywords": "投资款"},
            {"name": "代账", "icon": "📊", "keywords": "代账,记账服务"},
            {"name": "云资源", "icon": "☁️", "keywords": "阿里云,腾讯云,AWS,服务器,云服务"},
            {"name": "平台费用", "icon": "🏬", "keywords": "平台费,平台服务费"},
            {"name": "项目测试", "icon": "🧪", "keywords": "测试费"},
            {"name": "营销", "icon": "📢", "keywords": "营销,推广,广告,SEM,信息流"},
            {"name": "员工工资", "icon": "💴", "keywords": "工资,薪资,劳务"},
        ],
    },
]


INCOME_TREE = [
    {
        "name": "工作收入", "icon": "💼",
        "children": [
            {"name": "工资-头", "icon": "💼", "keywords": ""},
            {"name": "工资-腾", "icon": "💼", "keywords": ""},
            {"name": "差旅津贴", "icon": "🧳", "keywords": "差旅津贴,出差补助"},
            {"name": "公积金-头", "icon": "🏠", "keywords": ""},
            {"name": "公积金-腾", "icon": "🏠", "keywords": ""},
            {"name": "奖金", "icon": "🏆", "keywords": "奖金,年终奖,绩效"},
            {"name": "退税", "icon": "💸", "keywords": "退税,个税"},
        ],
    },
    {
        "name": "人情收入", "icon": "🧧",
        "children": [
            {"name": "红包", "icon": "🧧", "keywords": "红包"},
            {"name": "婚礼礼金", "icon": "💝", "keywords": "礼金,份子钱"},
        ],
    },
    {
        "name": "娱乐收入", "icon": "🎰",
        "children": [
            {"name": "抢红包", "icon": "🧧", "keywords": "抢红包"},
            {"name": "AA退款", "icon": "💸", "keywords": "AA,AA退款"},
            {"name": "麻将德州", "icon": "🀄", "keywords": "麻将,德州"},
            {"name": "彩票", "icon": "🎫", "keywords": "彩票"},
        ],
    },
    {
        "name": "退款报销", "icon": "↩️",
        "children": [
            {"name": "报销", "icon": "💼", "keywords": "报销"},
            {"name": "购物退款", "icon": "↩️", "keywords": "退款,退货"},
            {"name": "二手闲置", "icon": "🔄", "keywords": "闲鱼,转转,二手"},
            # "其他收入" 既是退款报销的子分类，也作为收入侧的兜底（categorizer 按名查找）
            {"name": "其他收入", "icon": "💎", "keywords": ""},
        ],
    },
    {
        "name": "金融收入", "icon": "📈",
        "children": [
            {"name": "基金收益", "icon": "📈", "keywords": "基金收益"},
            {"name": "利息收入", "icon": "💰", "keywords": "利息"},
            {"name": "平账", "icon": "⚖️", "keywords": "平账"},
            {"name": "股票收益", "icon": "📈", "keywords": "股票收益"},
            {"name": "理财产品收益", "icon": "💰", "keywords": "理财收益,理财产品"},
        ],
    },
    {
        "name": "其他收入", "icon": "💎",
        "children": [
            {"name": "社保代缴退款", "icon": "↩️", "keywords": "社保,代缴"},
        ],
    },
]


# 兜底分类（顶层叶子，无 parent）。
# - "其他支出"：导入找不到匹配的支出兜底（categorizer 按名 "其他支出" 查找）
# - "其他收入" 已经作为"退款报销"的子分类存在，无需重复创建
FALLBACK_CATEGORIES = [
    {"name": "其他支出", "icon": "💰", "type": "expense", "keywords": "", "sort_order": 999},
]


async def _seed_tree(db, tree: list[dict], type_: str):
    """插入一棵分类树（父分类 + 子分类）。"""
    for sort_order, parent_data in enumerate(tree):
        parent = Category(
            name=parent_data["name"],
            icon=parent_data["icon"],
            type=type_,
            keywords="",  # 父类不参与关键词匹配
            sort_order=sort_order,
        )
        db.add(parent)
        await db.flush()
        for child_order, child in enumerate(parent_data["children"]):
            db.add(Category(
                name=child["name"],
                icon=child["icon"],
                type=type_,
                keywords=child.get("keywords", ""),
                parent_id=parent.id,
                sort_order=child_order,
            ))


async def seed_defaults(db):
    """如果数据库为空，插入默认分类。"""
    result = await db.execute(select(Category).limit(1))
    if result.scalar():
        return  # 已有数据，跳过

    await _seed_tree(db, EXPENSE_TREE, "expense")
    await _seed_tree(db, INCOME_TREE, "income")

    for cat_data in FALLBACK_CATEGORIES:
        db.add(Category(**cat_data))

    await db.commit()
