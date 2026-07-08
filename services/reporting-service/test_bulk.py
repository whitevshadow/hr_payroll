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
        resp = await client.get('http://127.0.0.1:8010/api/v1/reports/payslips/bulk/8cdaea8a-6efa-4c52-9e70-52705763a0e8', headers={'Authorization': f'Bearer {token}'})
        print('Status:', resp.status_code)
        print('Headers:', dict(resp.headers))
        content = resp.content
        print('Size:', len(content))
        print('First 100 bytes:', repr(content[:100]))

if __name__ == '__main__':
    asyncio.run(main())
