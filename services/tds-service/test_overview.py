import httpx, json, asyncio

async def test():
    async with httpx.AsyncClient(timeout=10) as c:
        # Login to get token
        r = await c.post('http://auth-service:8001/api/v1/auth/login', json={'email': 'admin@demo.com', 'password': 'Admin@123'})
        token = r.json()['access_token']
        
        # Test overview for Asha (CTC 12L)
        r2 = await c.get(
            'http://localhost:8007/api/v1/tds/overview/ed7841ae-07b4-41c0-9fb6-05b9504d03d1',
            headers={'Authorization': f'Bearer {token}'}
        )
        print('STATUS:', r2.status_code)
        if r2.status_code == 200:
            data = r2.json()
            ov = data['employee_overview']
            print(f'Annual Gross: {ov["annual_gross"]}')
            print(f'Total Deductions: {ov["total_deductions"]}')
            print(f'Taxable Income: {ov["taxable_income"]}')
            print(f'Annual Tax: {ov["annual_tax"]}')
            print(f'Monthly TDS: {ov["monthly_tds"]}')
            print(f'Effective Rate: {ov["effective_rate"]}%')
            print(f'Recommended: {data["recommended"]}')
            print(f'Savings: {data["savings"]}')
            print(f'Remaining Months: {data["remaining_months"]}')
            print(f'Alerts ({len(data["alerts"])}):')
            for a in data['alerts']:
                print(f'  [{a["type"]}] {a["message"]}')
        else:
            print('ERROR:', r2.text[:500])

        # Test declarations endpoint
        r3 = await c.get(
            'http://localhost:8007/api/v1/tds/declarations/ed7841ae-07b4-41c0-9fb6-05b9504d03d1',
            headers={'Authorization': f'Bearer {token}'}
        )
        print(f'\nDeclarations STATUS: {r3.status_code}')
        if r3.status_code == 200:
            dd = r3.json()
            print(f'Has declaration: {dd["has_declaration"]}')
            print(f'Tax year: {dd["tax_year"]}')

asyncio.run(test())
