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
            "http://reporting-service:8010/api/v1/reports/payslips/generate",
            headers={"Authorization": f"Bearer {token}", "x-client-id": "30a3af2b-9bd3-4b12-9888-44273978a60e"},
            json={
                "cycle_id": "57fe2973-d9f5-40ba-b5ef-c279d4212979",
                "employee_ids": [
                    "27cd89aa-6b9a-41b2-a630-ec8694f8ceaf",
                    "3dded3e8-8a83-4717-8375-40c2743393a7",
                    "79f51949-15fc-4f16-9d0c-6e8d7fac4b42"
                ]
            }
        )
        print(f"Status: {resp.status_code}")
        print(resp.text)

if __name__ == "__main__":
    asyncio.run(main())
