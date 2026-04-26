# Family Ledger - 家庭记账

## 启动方法

### 1. 启动后端
```bash
cd backend
source venv/Scripts/activate   # Windows
uvicorn main:app --reload --port 8000
```

### 2. 启动前端
```bash
cd frontend
npm run dev
```

然后打开 http://localhost:5173 即可使用。
