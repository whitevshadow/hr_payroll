import asyncio
import httpx
from hr_shared import auth

async def main():
    token = auth.create_access_token(
        user_id="b41f71a0-3883-43d9-a477-98782a20fc9c",
        tenant_id="c302891a-dd2d-4b0e-9a2c-0ad65517d727",
        roles=["SUPER_ADMIN"],
        secret="3Dx6rEFInemPjMHiZRGTU2IiyvVt_6_tVH419x-90RI"
    )
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "http://payroll-service:8006/api/v1/payroll/cycles/57fe2973-d9f5-40ba-b5ef-c279d4212979/approve",
            headers={"Authorization": f"Bearer {token}", "x-client-id": "30a3af2b-9bd3-4b12-9888-44273978a60e"}
        )
        print(f"Status: {resp.status_code}")
        print(resp.text)

if __name__ == "__main__":
    asyncio.run(main())
