"""One-time, Hub-wide setup for the member conversation model."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import require_perm
from ..models import AppSetting
from ..services import client_domain_events, model_catalog
from ..services.model_runtime import lock_setting

router = APIRouter(
    prefix="/api/v1/admin/first-run-setup",
    dependencies=[Depends(require_perm("integration.manage"))],
)


def connection_check(row):
    return (row.get("capabilityCheck") or {}).get("checks", {}).get("connection", {})


def verified(row):
    return connection_check(row).get("status") == "passed"


@router.get("")
async def get_setup(session: AsyncSession = Depends(get_session)):
    saved = await session.get(AppSetting, model_catalog.MEMBER_DEFAULT_KEY)
    if saved and saved.value:
        return {"stage": "complete"}
    models = await model_catalog.usable(session)
    verified_models = [row for row in models if verified(row)]
    candidates = verified_models or models
    legacy = await session.get(AppSetting, "llm_model")
    preferred = next((row for row in candidates if legacy and row["name"] == legacy.value), None)
    recent = max(candidates, key=lambda row: connection_check(row).get("checkedAt", ""), default=None)
    model = recent if recent and connection_check(recent) else preferred or recent
    return {
        "stage": "default" if verified_models else "test" if model else "connect",
        "modelId": model["id"] if model else None,
        "models": [
            {key: row[key] for key in ("id", "providerId", "name", "label", "configRevision")}
            | {"verified": verified(row)}
            for row in candidates
        ],
    }


class FinishSetup(BaseModel):
    modelId: str
    configRevision: str


@router.put("")
async def finish_setup(body: FinishSetup, session: AsyncSession = Depends(get_session)):
    saved = await lock_setting(session, model_catalog.MEMBER_DEFAULT_KEY, "")
    if saved.value:
        return {"stage": "complete"}
    model = next((row for row in await model_catalog.usable(session)
                  if row["id"] == body.modelId), None)
    if not model or not verified(model) or model["configRevision"] != body.configRevision:
        raise HTTPException(409, "模型配置或使用权限已变更，请刷新并重新测试")
    saved.value = model["id"]
    await session.commit()
    await client_domain_events.models_changed(session)
    return {"stage": "complete"}
