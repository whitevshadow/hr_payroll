import asyncio
import httpx
from hr_shared.auth import create_access_token
import uuid

async def main():
    token = create_access_token(
        user_id=uuid.uuid4(),
        tenant_id=uuid.UUID('286ef0de-9651-472d-9df7-14f34a11ee5f'),
        roles=['ORG_ADMIN'],
        secret='super-secret-shared-key-change-me',
    )
    async with httpx.AsyncClient() as client:
        resp = await client.get('http://127.0.0.1:4009/api/v1/reports/payslip/8cdaea8a-6efa-4c52-9e70-52705763a0e8/ed7841ae-07b4-41c0-9fb6-05b9504d03d1', headers={'Authorization': f'Bearer {token}'})
        data = resp.json()
        print('Type of data["url"]:', type(data['url']))
        print('Value of data["url"]:', repr(data['url']))

if __name__ == '__main__':
    asyncio.run(main())
