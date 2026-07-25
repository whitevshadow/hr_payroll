import asyncio
from app.storage import minio_client as minio
async def main():
    try:
        stream = minio.download_object_stream('payroll/2026/06/payslips/b2429cd5-4a64-4fe3-9348-30c78bdc50f4.pdf', 'tenant-286ef0de-9651-472d-9df7-14f34a11ee5f')
        content = b''.join([chunk for chunk in stream])
        print('Size:', len(content))
        print('Content:', repr(content[:200]))
    except Exception as e:
        print('Error:', e)
asyncio.run(main())
