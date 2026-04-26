"""标签系统接口

TagCategory（标签分类/抽屉）CRUD
Tag（标签）CRUD + 归档 / 取消归档 / 移动分类 / 删除
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.models import Tag, TagCategory
from app.schemas import (
    TagCategoryCreate, TagCategoryUpdate, TagCategoryOut,
    TagCreate, TagUpdate, TagOut,
)

router = APIRouter(prefix="/api/tags", tags=["tags"])


# ─── TagCategory ──────────────────────────────────────────────────────────────

@router.get("/categories", response_model=list[TagCategoryOut])
async def list_tag_categories(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TagCategory).order_by(TagCategory.sort_order, TagCategory.id)
    )
    return result.scalars().all()


@router.post("/categories", response_model=TagCategoryOut)
async def create_tag_category(data: TagCategoryCreate, db: AsyncSession = Depends(get_db)):
    cat = TagCategory(**data.model_dump())
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return cat


@router.put("/categories/{cat_id}", response_model=TagCategoryOut)
async def update_tag_category(cat_id: int, data: TagCategoryUpdate, db: AsyncSession = Depends(get_db)):
    cat = await db.get(TagCategory, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="标签分类不存在")
    for k, v in data.model_dump().items():
        setattr(cat, k, v)
    await db.commit()
    await db.refresh(cat)
    return cat


@router.delete("/categories/{cat_id}")
async def delete_tag_category(cat_id: int, db: AsyncSession = Depends(get_db)):
    cat = await db.get(TagCategory, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="标签分类不存在")
    # 级联删除（cascade="all, delete-orphan"）会自动删除下属 Tag
    await db.delete(cat)
    await db.commit()
    return {"ok": True}


# ─── Tag ──────────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[TagOut])
async def list_tags(
    category_id: int = None,
    include_archived: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """列出标签。默认只返回未归档的；include_archived=true 返回全部。"""
    query = (
        select(Tag)
        .options(selectinload(Tag.category))
        .order_by(Tag.category_id, Tag.sort_order, Tag.id)
    )
    if category_id is not None:
        query = query.where(Tag.category_id == category_id)
    if not include_archived:
        query = query.where(Tag.is_archived == False)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/", response_model=TagOut)
async def create_tag(data: TagCreate, db: AsyncSession = Depends(get_db)):
    # 全局唯一性校验
    existing = await db.execute(select(Tag).where(Tag.name == data.name))
    if existing.scalar():
        raise HTTPException(status_code=409, detail=f"标签「{data.name}」已存在")
    # 分类存在性校验
    cat = await db.get(TagCategory, data.category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="标签分类不存在")

    tag = Tag(**data.model_dump())
    db.add(tag)
    await db.commit()
    result = await db.execute(
        select(Tag).options(selectinload(Tag.category)).where(Tag.id == tag.id)
    )
    return result.scalar_one()


@router.put("/{tag_id}", response_model=TagOut)
async def update_tag(tag_id: int, data: TagUpdate, db: AsyncSession = Depends(get_db)):
    tag = await db.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="标签不存在")
    # 名称变更时校验全局唯一
    if data.name != tag.name:
        existing = await db.execute(select(Tag).where(Tag.name == data.name))
        if existing.scalar():
            raise HTTPException(status_code=409, detail=f"标签「{data.name}」已存在")
    tag.name = data.name
    tag.icon = data.icon
    tag.sort_order = data.sort_order
    await db.commit()
    result = await db.execute(
        select(Tag).options(selectinload(Tag.category)).where(Tag.id == tag_id)
    )
    return result.scalar_one()


@router.post("/{tag_id}/archive", response_model=TagOut)
async def archive_tag(tag_id: int, db: AsyncSession = Depends(get_db)):
    tag = await db.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="标签不存在")
    tag.is_archived = True
    await db.commit()
    result = await db.execute(
        select(Tag).options(selectinload(Tag.category)).where(Tag.id == tag_id)
    )
    return result.scalar_one()


@router.post("/{tag_id}/unarchive", response_model=TagOut)
async def unarchive_tag(tag_id: int, db: AsyncSession = Depends(get_db)):
    tag = await db.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="标签不存在")
    tag.is_archived = False
    await db.commit()
    result = await db.execute(
        select(Tag).options(selectinload(Tag.category)).where(Tag.id == tag_id)
    )
    return result.scalar_one()


class MoveTagRequest(BaseModel):
    category_id: int


@router.post("/{tag_id}/move", response_model=TagOut)
async def move_tag(tag_id: int, req: MoveTagRequest, db: AsyncSession = Depends(get_db)):
    """移动标签到另一个分类"""
    tag = await db.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="标签不存在")
    cat = await db.get(TagCategory, req.category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="目标分类不存在")
    tag.category_id = req.category_id
    await db.commit()
    result = await db.execute(
        select(Tag).options(selectinload(Tag.category)).where(Tag.id == tag_id)
    )
    return result.scalar_one()


@router.delete("/{tag_id}")
async def delete_tag(tag_id: int, db: AsyncSession = Depends(get_db)):
    """
    删除标签：自动从所有 transaction_tags/account_tags/holding_tags 中移除（CASCADE），
    但账单/账户/持仓本身不删除。
    """
    tag = await db.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="标签不存在")
    await db.delete(tag)
    await db.commit()
    return {"ok": True}
