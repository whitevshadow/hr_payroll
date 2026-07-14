import asyncio
import httpx
from hr_shared.auth import create_access_token
import uuid

async def main():
    token = create_access_token(
        user_id=uuid.uuid4(),
        tenant_id=uuid.UUID("286ef0de-9651-472d-9df7-14f34a11ee5f"), # tenant from previous logs
        roles=["ORG_ADMIN"],
        secret="super-secret-shared-key-change-me",
    )
    
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "http://127.0.0.1:4009/api/v1/reports/payslips/generate",
            json={
                "cycle_id": "8cdaea8a-6efa-4c52-9e70-52705763a0e8",
                "employee_ids": ["ed7841ae-07b4-41c0-9fb6-05b9504d03d1"]
            },
            headers={"Authorization": f"Bearer {token}"},
            timeout=30.0
        )
        print("Status:", resp.status_code)
        print("Body:", resp.text)

if __name__ == "__main__":
    asyncio.run(main())
