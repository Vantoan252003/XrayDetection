import asyncio
import asyncpg
import json
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://xray:secret@localhost:5432/xraydb")

async def main():
    print(f"Connecting to database: {DATABASE_URL}")
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        rows = await conn.fetch("SELECT id, scores, top_disease, is_normal FROM scans")
        print(f"Found {len(rows)} scans in the database.")
        
        updated_count = 0
        for r in rows:
            scan_id = r["id"]
            scores_raw = r["scores"]
            
            if isinstance(scores_raw, str):
                scores = json.loads(scores_raw)
            elif isinstance(scores_raw, dict):
                scores = scores_raw
            else:
                scores = {}
                
            is_normal = len(scores) == 0
            top_disease = max(scores, key=scores.get) if scores else None
            top_score = scores.get(top_disease, 0) if top_disease else 0
            
            # Align threshold to 0.7
            if top_score <= 0.7:
                new_top_disease = None
                new_is_normal = True
            else:
                new_top_disease = top_disease
                new_is_normal = False
                
            if new_top_disease != r["top_disease"] or new_is_normal != r["is_normal"]:
                await conn.execute(
                    "UPDATE scans SET top_disease = $1, is_normal = $2 WHERE id = $3",
                    new_top_disease, new_is_normal, scan_id
                )
                updated_count += 1
                
        print(f"Successfully updated {updated_count} scans to match the 70% threshold.")
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
