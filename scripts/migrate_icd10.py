import asyncio
import asyncpg
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://xray:secret@localhost:5432/xraydb")

async def main():
    print(f"Connecting to database: {DATABASE_URL}")
    try:
        conn = await asyncpg.connect(DATABASE_URL)
        print("Connected! Running migration queries...")
        
        # Add icd_code and icd_group if they do not exist
        await conn.execute("""
            ALTER TABLE scans ADD COLUMN IF NOT EXISTS icd_code TEXT;
            ALTER TABLE scans ADD COLUMN IF NOT EXISTS icd_group TEXT;
        """)
        print("Migration query executed successfully!")
        
        # Check table columns
        columns = await conn.fetch("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'scans';
        """)
        col_names = [r["column_name"] for r in columns]
        print(f"Current columns in 'scans' table: {', '.join(col_names)}")
        
        if "icd_code" in col_names and "icd_group" in col_names:
            print("Verification SUCCESS: Columns 'icd_code' and 'icd_group' exist in 'scans' table.")
        else:
            print("Verification FAILED: Missing columns.")
            
        await conn.close()
    except Exception as e:
        print(f"Migration error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
