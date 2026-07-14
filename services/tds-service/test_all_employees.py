import httpx, asyncio

async def test():
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post('http://auth-service:4001/api/v1/auth/login', json={'email': 'admin@demo.com', 'password': 'Admin@123'})
        token = r.json()['access_token']
        
        # Get all employees
        r2 = await c.get('http://employee-service:4002/api/v1/employees?page_size=200', headers={'Authorization': f'Bearer {token}'})
        employees = r2.json()['items']
        
        print(f"{'Name':<20} {'CTC':>12} {'Annual Tax':>12} {'Monthly TDS':>12} {'Rate':>8} {'Regime':>8}")
        print("-" * 80)
        
        for emp in employees:
            eid = emp['id']
            name = f"{emp['first_name']} {emp['last_name']}"
            r3 = await c.get(
                f'http://localhost:4006/api/v1/tds/overview/{eid}',
                headers={'Authorization': f'Bearer {token}'}
            )
            if r3.status_code == 200:
                data = r3.json()
                ov = data['employee_overview']
                print(f"{name:<20} {ov['annual_gross']:>12} {ov['annual_tax']:>12} {ov['monthly_tds']:>12} {ov['effective_rate']:>7}% {data['recommended']:>8}")
            else:
                print(f"{name:<20} ERROR: {r3.status_code} - {r3.text[:80]}")

asyncio.run(test())
