"""向 yj_forum 数据库播种同构测试数据（供新旧版对比基准）。
用法: PORT=3100 已启动 Flask 后: .venv/bin/python seed_legacy.py
先清理旧数据再插入，保证可重复执行。
"""
import sys
sys.path.insert(0, '.')
sys.path.insert(0, './main')

from werkzeug.security import generate_password_hash
from api import database as db
from api import config

# 复用旧版函数播种
def seed():
    print("==> 清理旧数据")
    # 按外键顺序删除
    for table in ['post_reports', 'bug_reports', 'version_votes', 'post_favorites', 'post_likes',
                  'user_follows', 'verify_codes', 'verify_tokens', 'comments', 'World', 'posts', 'users']:
        db.execute_query(f"DELETE FROM {table}")
    print("    清理完成")

    users = [
        {"name": "小黑", "email": "xiaohei@test.local", "password": "Test1234", "vip": "1",
         "gender": 0, "age": "12", "intro": "我是小黑，一只会变身的小妖精。", "email_verified": 1},
        {"name": "白小白", "email": "baixiaobai@test.local", "password": "Test1234", "vip": "0",
         "gender": 0, "age": "16", "intro": "大家好，我是白小白，喜欢穿白裙子的少女。", "email_verified": 1},
        {"name": "无限", "email": "wuxian@test.local", "password": "Test1234", "vip": "1",
         "gender": 0, "age": "30", "intro": "等一朵花开，等一只妖来。", "email_verified": 1},
        {"name": "风息", "email": "fengxi@test.local", "password": "Test1234", "vip": "0",
         "gender": 0, "age": "25", "intro": "风息，喜欢清净。", "email_verified": 0},
        {"name": "测试员甲", "email": "tester1@test.local", "password": "Test1234", "vip": "0",
         "gender": 1, "age": "20", "intro": "测试账号。", "email_verified": 0},
        {"name": "封禁用户", "email": "banned@test.local", "password": "Test1234", "vip": "0",
         "gender": 0, "age": "99", "intro": "我被封禁了。", "email_verified": 1, "is_banned": 1},
    ]

    user_ids = {}
    print("==> 创建用户")
    for u in users:
        r = db.new_user(u["name"], u["email"], generate_password_hash(u["password"]))
        assert r.get("success"), f"创建用户失败: {r}"
        uid = r["id"]
        # 完善资料
        db.update_user_profile(uid, Name=u["name"], gender=u["gender"], age=u["age"], intro=u["intro"])
        # 修正 vip / email_verified / is_banned（new_user 只设置 vip=config.vip）
        db.execute_query(
            "UPDATE users SET vip=%s, email_verified=%s, is_banned=%s WHERE id=%s",
            (u["vip"], u.get("email_verified", 0), u.get("is_banned", 0), uid)
        )
        user_ids[u["name"]] = uid
        print(f"    {u['name']} -> {uid}")

    print("==> 创建帖子")
    posts_data = [
        ("小黑", "欢迎来到妖精论坛", "这里是罗小黑战记同人社区，请大家和睦相处！\n\n[**小黑** 的留言]", "general"),
        ("小黑", "今天在森林里遇到了新朋友", "今天在森林里遇到了一只猫，它说它是...哈哈，大家猜猜看？", "talk"),
        ("白小白", "求推荐好看的漫画", "最近书荒了，大家有什么好看的漫画推荐吗？", "share"),
        ("无限", "关于妖力修炼的一些心得", "妖力修炼讲究心静，这里是我的一些心得...\n1. 早起\n2. 打坐\n3. 冥想", "creative"),
        ("无限", "求助：如何让妖精化形更稳定", "最近遇到一只小妖精化形不稳定，求大神指点。", "求助"),
        ("风息", "我的森林小屋", "晒一下我亲手搭的森林小屋，欢迎大家来玩！", "general"),
        ("测试员甲", "这是一个测试帖子", "用于验证搜索和列表功能的测试内容。", "talk"),
    ]
    post_ids = {}
    for name, title, content, cat in posts_data:
        r = db.Send_Post(user_ids[name], title, content, cat)
        assert r.get("success"), f"发帖失败: {r}"
        post_ids[title] = r["id"]
        print(f"    [{title}] -> {r['id']}")

    print("==> 创建评论/回复")
    comments_data = [
        ("白小白", post_ids["欢迎来到妖精论坛"], "欢迎小黑！这里好热闹~", None),
        ("风息", post_ids["欢迎来到妖精论坛"], "新人报道，请多关照。", None),
        ("无限", post_ids["欢迎来到妖精论坛"], "欢迎欢迎！", None),
        ("小黑", post_ids["欢迎来到妖精论坛"], "谢谢大家！（回复风息）", None),  # parent 会挂到上一条？
        ("测试员甲", post_ids["求推荐好看的漫画"], "推荐《罗小黑战记》！好看！", None),
        ("小黑", post_ids["关于妖力修炼的一些心得"], "无限大佬的帖子学到了！", None),
    ]
    for name, pid, content, parent in comments_data:
        r = db.add_comment(pid, user_ids[name], content, parent)
        assert r.get("success"), f"评论失败: {r}"
        print(f"    {name}: {content[:16]}... -> {r['comment']['id']}")

    print("==> 创建点赞/收藏/关注")
    db.like_post(post_ids["欢迎来到妖精论坛"], user_ids["白小白"])
    db.like_post(post_ids["欢迎来到妖精论坛"], user_ids["风息"])
    db.like_post(post_ids["关于妖力修炼的一些心得"], user_ids["小黑"])
    db.toggle_favorite(post_ids["关于妖力修炼的一些心得"], user_ids["白小白"])
    db.toggle_favorite(post_ids["我的森林小屋"], user_ids["小黑"])
    db.toggle_follow(user_ids["小黑"], user_ids["无限"])
    db.toggle_follow(user_ids["白小白"], user_ids["小黑"])
    db.toggle_follow(user_ids["测试员甲"], user_ids["无限"])
    print("    完成")

    print("==> 创建世界消息")
    db.SendWorldMessage(user_ids["小黑"], "小黑", "大家好！我刚上线~")
    db.SendWorldMessage(user_ids["白小白"], "白小白", "今天天气真好！")
    db.SendWorldMessage(user_ids["无限"], "无限", "妖力修炼中，勿扰。")
    db.SendWorldMessage(user_ids["风息"], "风息", "森林小屋翻新完成！")
    print("    完成")

    print("==> 创建版本投票")
    db.vote_version("u:" + user_ids["小黑"], "v1", user_ids["小黑"], "小黑")
    db.vote_version("u:" + user_ids["白小白"], "v2", user_ids["白小白"], "白小白")
    db.vote_version("u:" + user_ids["无限"], "v1", user_ids["无限"], "无限")
    print("    完成")

    print("\n==> Seed 完成！")
    print("用户:", len(users), "帖子:", len(posts_data), "评论:", len(comments_data))

if __name__ == "__main__":
    seed()
