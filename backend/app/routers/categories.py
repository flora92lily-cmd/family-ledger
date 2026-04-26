from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import Category
from app.schemas import CategoryCreate, CategoryOut, CategoryTree

router = APIRouter(prefix="/api/categories", tags=["categories"])


def _build_tree(cats: list[Category]) -> list[CategoryTree]:
    """将扁平列表转成父→子树形"""
    by_id: dict[int, CategoryTree] = {}
    roots: list[CategoryTree] = []
    # 先建所有节点
    for c in sorted(cats, key=lambda x: (x.sort_order, x.id)):
        node = CategoryTree.model_validate(c)
        by_id[c.id] = node
    # 再挂子节点
    for c in cats:
        node = by_id[c.id]
        if c.parent_id and c.parent_id in by_id:
            by_id[c.parent_id].children.append(node)
        else:
            roots.append(node)
    return roots


@router.get("/", response_model=list[CategoryOut])
async def list_categories(type: str = None, db: AsyncSession = Depends(get_db)):
    """平铺列表（供 ImportPage 下拉选用）"""
    query = select(Category).order_by(Category.sort_order, Category.id)
    if type:
        query = query.where(Category.type == type)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/tree", response_model=list[CategoryTree])
async def list_categories_tree(type: str = None, db: AsyncSession = Depends(get_db)):
    """树形结构（供设置页分类管理用）"""
    query = select(Category).order_by(Category.sort_order, Category.id)
    if type:
        query = query.where(Category.type == type)
    result = await db.execute(query)
    return _build_tree(result.scalars().all())


@router.post("/", response_model=CategoryOut)
async def create_category(data: CategoryCreate, db: AsyncSession = Depends(get_db)):
    cat = Category(**data.model_dump())
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return cat


@router.put("/{cat_id}", response_model=CategoryOut)
async def update_category(cat_id: int, data: CategoryCreate, db: AsyncSession = Depends(get_db)):
    cat = await db.get(Category, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    for key, val in data.model_dump().items():
        setattr(cat, key, val)
    await db.commit()
    await db.refresh(cat)
    return cat


@router.delete("/{cat_id}")
async def delete_category(cat_id: int, db: AsyncSession = Depends(get_db)):
    cat = await db.get(Category, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    # 如果有子分类，把子分类的 parent_id 置空（提升为一级）
    children_result = await db.execute(select(Category).where(Category.parent_id == cat_id))
    for child in children_result.scalars().all():
        child.parent_id = None
    await db.delete(cat)
    await db.commit()
    return {"ok": True}
