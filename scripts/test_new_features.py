import requests
import io
import time

URL_BASE = "http://127.0.0.1:8000"

def test_health():
    print("Testing /health endpoint...")
    r = requests.get(f"{URL_BASE}/health")
    assert r.status_code == 200, f"Health check failed: {r.text}"
    print("Health check passed:", r.json())

def test_model_versions():
    print("\nTesting /model-versions endpoint...")
    r = requests.get(f"{URL_BASE}/model-versions")
    assert r.status_code == 200, f"Model versions listing failed: {r.text}"
    print("Model versions:", r.json())

def test_batch_analyze():
    print("\nTesting /batch-analyze endpoint...")
    from PIL import Image
    
    # Tạo ảnh JPEG hợp lệ trong bộ nhớ
    img1 = Image.new('L', (224, 224), color=128)
    img_bytes1 = io.BytesIO()
    img1.save(img_bytes1, format='JPEG')
    img_bytes1.seek(0)
    
    img2 = Image.new('L', (224, 224), color=200)
    img_bytes2 = io.BytesIO()
    img2.save(img_bytes2, format='JPEG')
    img_bytes2.seek(0)
    
    files = [
        ("files", ("test1.jpg", img_bytes1, "image/jpeg")),
        ("files", ("test2.jpg", img_bytes2, "image/jpeg")),
    ]
    data = {
        "ai_model": "gemini",
        "source": "batch"
    }
    r = requests.post(f"{URL_BASE}/batch-analyze", files=files, data=data)
    assert r.status_code == 200, f"Batch analyze failed: {r.text}"
    results = r.json()
    print(f"Batch analyze succeeded. Processed {len(results)} scans.")
    for res in results:
        print(f"- Scan ID: {res['scan_id']}, Image URL: {res['image_url']}, Pending review: {res.get('review_status') == 'pending' if 'review_status' in res else True}")
    return results

def test_pending_reviews():
    print("\nTesting /review/pending endpoint...")
    r = requests.get(f"{URL_BASE}/review/pending")
    assert r.status_code == 200, f"Review pending failed: {r.text}"
    data = r.json()
    print(f"Pending reviews count: {data['total']}")
    return data["scans"]

def test_approve_scan(scan_id):
    print(f"\nTesting /review/{scan_id}/approve...")
    payload = {
        "verified_labels": {
            "Pneumonia": True,
            "Effusion": False
        }
    }
    r = requests.post(f"{URL_BASE}/review/{scan_id}/approve", json=payload)
    assert r.status_code == 200, f"Approve failed: {r.text}"
    print("Approve success:", r.json())

def test_timeout_check():
    print("\nTesting /review/timeout-check...")
    r = requests.post(f"{URL_BASE}/review/timeout-check")
    assert r.status_code == 200, f"Timeout check trigger failed: {r.text}"
    print("Timeout check results:", r.json())

if __name__ == "__main__":
    print("=== STARTING NEW FEATURES VERIFICATION TESTS ===")
    try:
        test_health()
        test_model_versions()
        batch_results = test_batch_analyze()
        pending_scans = test_pending_reviews()
        
        if pending_scans:
            test_approve_scan(pending_scans[0]["id"])
            
        test_timeout_check()
        print("\n=== ALL TESTS PASSED SUCCESSFULLY! ===")
    except AssertionError as ae:
        print("\n❌ TEST FAILED:", ae)
    except Exception as e:
        print("\n❌ UNEXPECTED ERROR:", e)
