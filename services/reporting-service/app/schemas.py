from __future__ import annotations

import uuid

from pydantic import BaseModel


class GenerateRequest(BaseModel):
    cycle_id: uuid.UUID
    employee_ids: list[uuid.UUID]
