import sys
import os
import dotenv
dotenv.load_dotenv(override=False)  # 提前加载 .env，确保 main.main 内 SECRET_KEY 等可读
sys.path.append("./main")
from main.main import app

if __name__ == '__main__':
    port = int(os.getenv('PORT', '3000'))
    app.run(host='127.0.0.1', port=port)
