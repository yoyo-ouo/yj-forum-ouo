const footer = document.getElementById('footer')
const body = document.getElementById('body')
const WindowsCardWithCenterSreen = document.getElementById('WindowsCardWithCenterSreen')
const WindowsCardWithCenterSreenText = document.getElementById('WindowsCardWithCenterSreenText')

let timeControlEnabled = true
let currentTheme = 'day'
let timeCheckInterval = null

function debounce(fn, delay) {
    let timer = null;
    return function(...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

function throttle(fn, limit) {
    let inThrottle = false;
    return function(...args) {
        if (!inThrottle) {
            fn.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

function lazyLoadImages(container) {
    const root = container || document;
    const images = root.querySelectorAll('img:not([loading])');
    images.forEach(img => {
        if (!img.getAttribute('loading')) {
            img.setAttribute('loading', 'lazy');
            img.setAttribute('decoding', 'async');
        }
    });
}

if ('IntersectionObserver' in window) {
    window.__lazyObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const src = img.dataset.src;
                if (src) {
                    img.src = src;
                    img.removeAttribute('data-src');
                }
                window.__lazyObserver.unobserve(img);
            }
        });
    }, { rootMargin: '200px' });
}

function initLazyLoad(container) {
    const root = container || document;
    lazyLoadImages(root);
    if (window.__lazyObserver) {
        root.querySelectorAll('img[data-src]').forEach(img => {
            window.__lazyObserver.observe(img);
        });
    }
}

/**
 * 将用户名转为安全的 HTML 字符串（XSS 安全）。
 * 用于模板字面量/字符串拼接构建 HTML 的场景（如 innerHTML 模板）。
 * 文字部分通过 textContent 转义后嵌入 HTML，
 * |[TIME] token 转为 |<p class="TimeWithUserNameAPI"></p>。
 * 直接 DOM 注入请使用 setUsernameElement()（文字部分用 textContent，不经过 innerHTML）。
 */
function sanitizeUsernameHtml(name) {
    if (!name) return '';
    const token = '|[TIME]';
    const idx = name.indexOf(token);
    if (idx === -1) {
        // 无 |[TIME] token：旧逻辑 → 转义后向后兼容旧 <p> 彩蛋
        const div = document.createElement('div');
        div.textContent = name;
        let escaped = div.innerHTML;
        // ⚠ 安全：只允许 class 属性，丢弃所有其他属性（包括 onclick 等事件处理器）
        escaped = escaped.replace(/&lt;p((?:(?!&gt;).)*)&gt;/gi, (match, attrs) => {
            if (attrs) {
                const decoded = attrs
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .replace(/&gt;/g, '>')
                    .replace(/&lt;/g, '<')
                    .replace(/&amp;/g, '&');
                const classMatch = decoded.match(/\bclass\s*=\s*"([^"]*)"/i);
                if (classMatch) {
                    // class 属性值是纯 CSS 类名，不会执行脚本
                    return `<p class="${classMatch[1]}">`;
                }
            }
            return '<p>';
        });
        escaped = escaped.replace(/&lt;\/p&gt;/gi, '</p>');
        return escaped;
    }
    // 新格式：按 |[TIME] 分割，文字部分安全转义，token 转为 |<p class="TimeWithUserNameAPI"></p>
    const parts = name.split(token);
    const div = document.createElement('div');
    let result = '';
    for (let i = 0; i < parts.length; i++) {
        div.textContent = parts[i];
        result += div.innerHTML;
        if (i < parts.length - 1) {
            result += '|<p class="TimeWithUserNameAPI"></p>';
        }
    }
    return result;
}

/**
 * 将用户名安全地注入到 DOM 元素中。
 * 文字部分使用 textContent 注入（不以 HTML 方式注入），
 * |[TIME] token 作为 HTML 注入为 |<p class="TimeWithUserNameAPI"></p>。
 * 旧格式 <p> 彩蛋标签向后兼容。
 */
function setUsernameElement(el, name) {
    if (!el) return;
    if (!name) { el.textContent = ''; return; }

    // 始终先清空元素，避免与初始占位内容（如"加载中..."）拼接
    el.innerHTML = '';

    const token = '|[TIME]';
    const div = document.createElement('div');

    // 新格式：|[TIME] token
    if (name.includes(token)) {
        const parts = name.split(token);
        for (let i = 0; i < parts.length; i++) {
            div.textContent = parts[i];
            if (div.textContent) {
                el.appendChild(document.createTextNode(div.textContent));
            }
            if (i < parts.length - 1) {
                el.insertAdjacentHTML('beforeend', '|<p class="TimeWithUserNameAPI"></p>');
            }
        }
        return;
    }

    // 无 |[TIME] token：转义后向后兼容旧 <p> 彩蛋
    div.textContent = name;
    let escaped = div.innerHTML;
    // ⚠ 安全：只允许 class 属性，丢弃所有其他属性（包括 onclick 等事件处理器）
    escaped = escaped.replace(/&lt;p((?:(?!&gt;).)*)&gt;/gi, (match, attrs) => {
        if (attrs) {
            const decoded = attrs
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&gt;/g, '>')
                .replace(/&lt;/g, '<')
                .replace(/&amp;/g, '&');
            const classMatch = decoded.match(/\bclass\s*=\s*"([^"]*)"/i);
            if (classMatch) {
                return `<p class="${classMatch[1]}">`;
            }
        }
        return '<p>';
    });
    escaped = escaped.replace(/&lt;\/p&gt;/gi, '</p>');
    // 解析为 DOM 节点（已转义，仅 <p> 标签被保留）
    div.innerHTML = escaped;
    while (div.firstChild) {
        el.appendChild(div.firstChild);
    }
}

function stripEasterEgg(name) {
    return name
        .replace(/\|\[TIME\]/g, '')          // 新格式 |[TIME]
        .replace(/\|<p/gi, '<p')              // 兼容 |<p 格式
        .replace(/<p[^>]*>/gi, '')            // 旧格式 <p>（向后兼容）
        .replace(/<\/p>/gi, '');              // 旧格式 </p>（向后兼容）
}

function getUserPrefixBadge(userId) {
    if (!userId) return '';
    const prefix = userId.substring(0, 2).toUpperCase();
    const rest = userId.substring(2);
    const isSpecial = prefix === 'HG' && /^0+$/.test(rest);
    let bgColor = null;
    if (isSpecial) {
        bgColor = '#6366f1';
    } else if (prefix === 'HG') {
        bgColor = '#3b82f6';
    } else if (prefix === 'YJ') {
        bgColor = '#f59e0b';
    }
    if (!bgColor) return '';
    return `<span class="prefix-badge-inline" style="display:inline-flex;align-items:center;margin-left:4px;"><svg width="16" height="16" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg"><circle cx="11" cy="11" r="11" fill="${bgColor}"/><path d="M11 15L6 7H8L11 11L14 7H16L11 15Z" fill="white"/></svg></span>`;
}



function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return undefined;
}

/**
 * 统一 fetch 封装：自动携带同源 cookie（session），自动设置 JSON Content-Type。
 * 所有 API 请求必须使用此函数，避免 credentials 遗漏导致"请先登录"问题。
 * 用法与原生 fetch 完全一致，可直接替换。
 */
function apiFetch(url, options) {
    var opts = Object.assign({ credentials: 'same-origin' }, options || {});
    if (opts.body && !(opts.body instanceof FormData) && (!opts.headers || !opts.headers['Content-Type'])) {
        opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    }
    return fetch(url, opts);
}

let UserId = getCookie("user_id")

function loadGetHtml() {
    return Promise.resolve();
}

function loadUserInfo() {
    const cached = sessionStorage.getItem('userInfo');
    if (cached) {
        try {
            const u = JSON.parse(cached);
            document.getElementById('user-avatar').innerHTML = `<img alt="UserAvaterDOM" src="${u.avatar}">`;
            setUsernameElement(document.getElementById('user-name'), u.name);
            document.getElementById('UserInfo').href = `/users/${u.id}`;
            UserId = u.id;
            return Promise.resolve();
        } catch (_) { sessionStorage.removeItem('userInfo'); }
    }
    return apiFetch('/api/user/info')
        .then(res => res.json())
        .then(data => {
            if (data.success && data.user) {
                const user = data.user;
                document.getElementById('user-avatar').innerHTML = `<img alt="UserAvaterDOM" src="${user.avatar}">`;
                setUsernameElement(document.getElementById('user-name'), user.name);
                document.getElementById('UserInfo').href = `/users/${user.id}`;
                UserId = user.id;
                try { sessionStorage.setItem('userInfo', JSON.stringify({ id: user.id, name: user.name, avatar: user.avatar })); } catch(_) {}
            } else {
                document.getElementById('user-avatar').innerHTML = '<i class="fa fa-user"></i>';
                document.getElementById('user-name').textContent = '登录';
                document.getElementById('UserInfo').href = '/login';
                UserId = undefined;
                sessionStorage.removeItem('userInfo');
            }
        })
        .catch(() => {
            document.getElementById('user-avatar').innerHTML = '<i class="fa fa-user"></i>';
            document.getElementById('user-name').textContent = '登录';
            document.getElementById('UserInfo').href = '/login';
            UserId = undefined;
        });
}

function handleLogout() {
    if (!confirm('确定要退出登录吗？')) return;
    apiFetch('/api/logout', { method: 'POST' })
        .then(() => {
            UserId = undefined;
            sessionStorage.removeItem('userInfo');
            // 清掉后端下发的前端可读 user_id cookie（path=/）
            try { document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax;'; } catch(_) {}
            document.getElementById('user-avatar').innerHTML = '<i class="fa fa-user"></i>';
            document.getElementById('user-name').textContent = '登录';
            document.getElementById('UserInfo').href = '/login';
            if (window.location.pathname !== '/') {
                window.location.href = '/';
            } else {
                if (typeof loadHomePosts === 'function') {
                    loadHomePosts();
                }
            }
        })
        .catch(() => {
            UserId = undefined;
            sessionStorage.removeItem('userInfo');
            try { document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax;'; } catch(_) {}
            document.getElementById('user-avatar').innerHTML = '<i class="fa fa-user"></i>';
            document.getElementById('user-name').textContent = '登录';
            document.getElementById('UserInfo').href = '/login';
            if (window.location.pathname !== '/') {
                window.location.href = '/';
            }
        });
}


function GetHours(){
    return new Date().getHours()
}

function DayorNight(){
    let hours = GetHours()
    if (hours >=6 && hours < 18 ) {
        return 1
    }else {
        return 0
    }
}

function applyTheme(theme) {
    var root = document.documentElement;
    if (theme === 'day') {
        if (body) body.classList.remove('night-mode');
        root.classList.remove('night-mode');
        currentTheme = 'day';
    } else {
        if (body) body.classList.add('night-mode');
        root.classList.add('night-mode');
        currentTheme = 'night';
    }
}

function DayorNightToTurnWithHead(DOM){
    let DayNight = DayorNight()
    if (DayNight === 1) {
        applyTheme('day');
    }
    else {
        applyTheme('night');
    }
}

function setTheme(theme) {
    if (theme === 'day' || theme === 'night') {
        applyTheme(theme);
        console.log('[主题切换] 已切换到' + (theme === 'day' ? '亮色' : '暗色') + '模式');
    } else {
        console.warn('[主题切换] 参数错误：请传入 "day" 或 "night"');
    }
}

function toggleTheme() {
    if (currentTheme === 'day') {
        setTheme('night');
    } else {
        setTheme('day');
    }
    return currentTheme;
}

function setTimeControl(enabled) {
    timeControlEnabled = !!enabled;
    if (timeControlEnabled) {
        console.log('[时间控制] 已开启：将根据时间自动切换日夜间模式');
        startTimeCheck();
        DayorNightToTurnWithHead(body);
    } else {
        console.log('[时间控制] 已关闭：日夜间模式将保持当前状态');
        stopTimeCheck();
    }
    return timeControlEnabled;
}

function getTimeControlStatus() {
    return timeControlEnabled;
}

function checkTimeAndUpdate() {
    if (!timeControlEnabled) return;
    const dayNight = DayorNight();
    const expectedTheme = dayNight === 1 ? 'day' : 'night';
    if (expectedTheme !== currentTheme) {
        applyTheme(expectedTheme);
    }
}

function startTimeCheck() {
    if (timeCheckInterval) return;
    timeCheckInterval = setInterval(checkTimeAndUpdate, 60000);
}

function stopTimeCheck() {
    if (timeCheckInterval) {
        clearInterval(timeCheckInterval);
        timeCheckInterval = null;
    }
}

window.Theme = {
    setTheme: setTheme,
    toggleTheme: toggleTheme,
    setTimeControl: setTimeControl,
    getTimeControlStatus: getTimeControlStatus,
    getCurrentTheme: function() { return currentTheme; }
};

console.log('%c妖精论坛主题系统', 'color: #579491; font-size: 16px; font-weight: bold;');
console.log('%c可用命令:', 'color: #6A8C89; font-weight: bold;');
console.log('  Theme.setTheme("day")   - 切换到亮色模式');
console.log('  Theme.setTheme("night") - 切换到暗色模式');
console.log('  Theme.toggleTheme()     - 切换日夜间模式');
console.log('  Theme.setTimeControl(true/false) - 开启/关闭时间自动控制');
console.log('  Theme.getTimeControlStatus()    - 获取时间控制状态');
console.log('  Theme.getCurrentTheme()         - 获取当前主题');

DayorNightToTurnWithHead(body)
startTimeCheck();


function initSettingMenu() {
    const settingBtn = document.getElementById('settingBtn');
    const settingDropdown = document.getElementById('settingDropdown');
    const settingItems = document.querySelectorAll('.setting-dropdown-item');

    if (!settingBtn || !settingDropdown) return;

    function updateActiveState() {
        settingItems.forEach(item => {
            item.classList.remove('active');
        });

        if (!timeControlEnabled) {
            if (currentTheme === 'day') {
                const dayItem = document.querySelector('.setting-dropdown-item[data-value="day"]');
                if (dayItem) dayItem.classList.add('active');
            } else {
                const nightItem = document.querySelector('.setting-dropdown-item[data-value="night"]');
                if (nightItem) nightItem.classList.add('active');
            }
        } else {
            const defaultItem = document.querySelector('.setting-dropdown-item[data-value="default"]');
            if (defaultItem) defaultItem.classList.add('active');
        }
    }

    updateActiveState();

    settingBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const settingItem = settingBtn.closest('.header-setting');
        if (settingItem) {
            settingItem.classList.toggle('active');
        }
    });

    document.addEventListener('click', function(e) {
        const settingItem = settingBtn.closest('.header-setting');
        if (settingItem && !settingItem.contains(e.target)) {
            settingItem.classList.remove('active');
        }
    });

    function handleThemeChange(selected) {
        if (selected === 'day') {
            setTimeControl(false);
            setTheme('day');
        } else if (selected === 'night') {
            setTimeControl(false);
            setTheme('night');
        } else if (selected === 'default') {
            setTimeControl(true);
        }
        updateActiveState();
    }

    settingItems.forEach(item => {
        item.addEventListener('click', function() {
            const value = this.getAttribute('data-value');
            if (value) {
                handleThemeChange(value);
            }
        });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSettingMenu);
} else {
    initSettingMenu();
}

function initMobileMenu() {
    const toggle = document.getElementById('headerMenuToggle');
    const menu = document.getElementById('headerMobileMenu');
    if (!toggle || !menu) return;

    toggle.addEventListener('click', function(e) {
        e.stopPropagation();
        menu.classList.toggle('open');
    });

    document.addEventListener('click', function(e) {
        if (!menu.contains(e.target) && !toggle.contains(e.target)) {
            menu.classList.remove('open');
        }
    });

    menu.querySelectorAll('.mobile-theme-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const value = this.getAttribute('data-value');
            if (value === 'day') {
                setTimeControl(false);
                setTheme('day');
            } else if (value === 'night') {
                setTimeControl(false);
                setTheme('night');
            } else if (value === 'default') {
                setTimeControl(true);
            }
            menu.classList.remove('open');
        });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileMenu);
} else {
    initMobileMenu();
}


function UserInfoGet(UserId) {
    // 逻辑暂定

    let UserName = "11"
    let Useravter = "22"


    return [UserName,Useravter]
}
function SetUserInfoWithHeaderUserInfo(UserName, Useravater, UserID) {
    document.getElementById('user-avatar').innerHTML = `<img alt="UserAvaterDOM" src="${Useravater}">`
    setUsernameElement(document.getElementById('user-name'), UserName);
    document.getElementById('UserInfo').href = `/users/${UserID}`
}

function ShowOrhidenWindowsCardWithCenterSreen(A){
    if (A===0){
        WindowsCardWithCenterSreen.classList.remove('active');
    }else {
        WindowsCardWithCenterSreen.classList.add('active');

    }
}

document.addEventListener('click', function(e) {
    if (!WindowsCardWithCenterSreen) return;
    if (!WindowsCardWithCenterSreen.classList.contains('active')) return;

    const card = WindowsCardWithCenterSreen.querySelector('.windows-card');
    const closeBtn = WindowsCardWithCenterSreen.querySelector('.windows-card-close');

    if (card && closeBtn &&
        !card.contains(e.target) &&
        e.target !== closeBtn) {
        ShowOrhidenWindowsCardWithCenterSreen(0);
    }
}, true);

function UpdataWindowsCardWithCenterSreen(HTML){
    ShowOrhidenWindowsCardWithCenterSreen(1)
    WindowsCardWithCenterSreenText.innerHTML = HTML;
}

function Easter_Egg(){
    apiFetch("/Easter-Egg")
        .then(r => r.json())
        .then(data => {
            let Easter_Egg_ID = data["ID"]
            let Easter_Egg_Name = data["Name"]
            let Easter_Egg_Text = data["Text"]
            console.log(`Get The Easter Egg With ${Easter_Egg_ID}`)
            UpdataWindowsCardWithCenterSreen(`
<div style="text-align:center;padding:16px 0;">
    <div style="font-size:12px;letter-spacing:3px;color:var(--color-text-tertiary);margin-bottom:8px;">Easter Egg #${Easter_Egg_ID}</div>
    <div id="Easter-Egg-Name" style="font-size:22px;color:var(--color-text-secondary);letter-spacing:2px;margin-bottom:16px;">${Easter_Egg_Name}</div>
    <div style="width:40px;height:2px;background:linear-gradient(90deg,transparent,var(--color-primary),transparent);margin:0 auto 16px;"></div>
    <div id="Easter-Egg_Text" style="font-size:15px;line-height:1.8;color:var(--color-text-primary);">${Easter_Egg_Text}</div>
</div>
`)
        }
        )
}


function initAuthPage() {
    const tabs = document.querySelectorAll('.auth-tab');
    if (!tabs.length) return;

    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            tabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            const tabName = this.getAttribute('data-tab');
            if (tabName === 'login') {
                loginForm.style.display = 'block';
                registerForm.style.display = 'none';
            } else {
                loginForm.style.display = 'none';
                registerForm.style.display = 'block';
            }
            clearAuthErrors();
        });
    });

    const loginBtn = document.querySelector('#loginForm .auth-btn.primary');
    if (loginBtn) {
        loginBtn.addEventListener('click', handleLogin);
    }

    const registerBtn = document.querySelector('#registerForm .auth-btn.primary');
    if (registerBtn) {
        registerBtn.addEventListener('click', handleRegister);
    }

    const loginPwd = document.getElementById('loginPassword');
    if (loginPwd) {
        loginPwd.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') handleLogin();
        });
    }

    const regPwd = document.getElementById('regConfirmPassword');
    if (regPwd) {
        regPwd.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') handleRegister();
        });
    }

    const loginNameEl = document.getElementById('loginName');
    if (loginNameEl) {
        loginNameEl.addEventListener('input', function() {
            showAuthError('loginError', '');
        });
    }

    const regNameEl = document.getElementById('regName');
    if (regNameEl) {
        regNameEl.addEventListener('input', function() {
            const name = this.value.trim();
            const nameNoEgg = stripEasterEgg(name);
            if (name && (nameNoEgg.length < 2 || nameNoEgg.length > 20)) {
                showAuthError('registerError', '用户名需要2-20个字符（不含彩蛋）');
            } else {
                showAuthError('registerError', '');
            }
        });
    }
}

function clearAuthErrors() {
    const loginError = document.getElementById('loginError');
    const registerError = document.getElementById('registerError');
    if (loginError) loginError.textContent = '';
    if (registerError) registerError.textContent = '';
}

function showAuthError(elementId, message) {
    const el = document.getElementById(elementId);
    if (el) el.textContent = message;
}

function setAuthLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
        if (btn.dataset.loading === '1') return;
        btn.dataset.loading = '1';
        btn.dataset.originText = btn.innerHTML;
        btn.disabled = true;
        btn.classList.add('auth-btn-loading');
        btn.innerHTML = '<span class="auth-spinner"></span><span>处理中...</span>';
    } else {
        if (btn.dataset.loading !== '1') return;
        btn.dataset.loading = '0';
        btn.disabled = false;
        btn.classList.remove('auth-btn-loading');
        btn.innerHTML = btn.dataset.originText || btn.innerHTML;
        delete btn.dataset.originText;
    }
}

function handleLogin() {
    const name = document.getElementById('loginName').value.trim();
    const password = document.getElementById('loginPassword').value;
    const remember = document.getElementById('rememberMe').checked;
    const loginBtn = document.querySelector('#loginForm .auth-btn.primary');

    if (!name) {
        showAuthError('loginError', '请输入用户名或邮箱');
        return;
    }
    if (!password) {
        showAuthError('loginError', '请输入密码');
        return;
    }

    setAuthLoading(loginBtn, true);
    apiFetch('/api/login', {
        method: 'POST',
        body: JSON.stringify({ name: name, password: password, remember: remember })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            if (loginBtn) {
                loginBtn.innerHTML = '<span class="auth-spinner"></span><span>登录成功，跳转中...</span>';
            }
            window.location.href = '/';
        } else {
            setAuthLoading(loginBtn, false);
            showAuthError('loginError', data.message || '登录失败');
        }
    })
    .catch(() => {
        setAuthLoading(loginBtn, false);
        showAuthError('loginError', '网络错误，请稍后再试');
    });
}

function handleRegister() {
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirmPassword = document.getElementById('regConfirmPassword').value;
    const code = document.getElementById('regCode').value.trim().replace(/\D/g, '');
    const registerBtn = document.querySelector('#registerForm .auth-btn.primary');

    if (stripEasterEgg(name).length < 2 || stripEasterEgg(name).length > 20) {
        showAuthError('registerError', '用户名需要2-20个字符（不含彩蛋）');
        return;
    }
    if (!email || !email.includes('@')) {
        showAuthError('registerError', '请输入有效的邮箱');
        return;
    }
    if (password.length < 8) {
        showAuthError('registerError', '密码至少8位');
        return;
    }
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        showAuthError('registerError', '密码需包含字母和数字');
        return;
    }
    if (password !== confirmPassword) {
        showAuthError('registerError', '两次密码不一致');
        return;
    }
    if (!code || code.length !== 6) {
        showAuthError('registerError', '请输入6位数字验证码');
        return;
    }

    setAuthLoading(registerBtn, true);
    apiFetch('/api/register', {
        method: 'POST',
        body: JSON.stringify({ name: name, email: email, password: password, code: code })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            if (registerBtn) {
                registerBtn.innerHTML = '<span class="auth-spinner"></span><span>注册成功，跳转中...</span>';
            }
            window.location.href = '/';
        } else {
            setAuthLoading(registerBtn, false);
            showAuthError('registerError', data.message || '注册失败');
        }
    })
    .catch(() => {
        setAuthLoading(registerBtn, false);
        showAuthError('registerError', '网络错误，请稍后再试');
    });
}

function initMouseLinuxPage() {
    const mdEl = document.getElementById('Markdown');
    const licenseEl = document.getElementById('LICENSE');
    if (!mdEl) return;

    const params = new URLSearchParams(window.location.search);
    let mdPath;
    if (params.has("l") && params.get("l") === 'EN') {
        mdPath = "//assets.crazying-dev.top/text/one/mouse/Liunx/README_en-US.md";
    } else {
        mdPath = "//assets.crazying-dev.top/text/one/mouse/Liunx/README.md";
    }

    mdEl.innerHTML = '<p style="text-align:center;color:var(--color-text-tertiary);">加载中...</p>';

    fetch(mdPath)
        .then(resp => {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.text();
        })
        .then(mdText => {
            mdEl.innerHTML = marked.parse(mdText);
            addCopyButtons();
        })
        .catch(err => {
            mdEl.innerHTML = '<p style="color:red;text-align:center;">Markdown 加载失败: ' + err.message + '</p>';
            console.error('load Markdown error:', err);
        });

    if (licenseEl) {
        fetch("//assets.crazying-dev.top/text/one/mouse/Liunx/LICENSE")
            .then(d => d.text())
            .then(text => {
                licenseEl.innerText = text;
            })
            .catch(err => {
                licenseEl.innerText = 'LICENSE 加载失败';
                console.error('load LICENSE error:', err);
            });
    }
}

function initUserProfilePage() {
    const pageEl = document.querySelector('.user-profile-page');
    if (!pageEl) return;

    const pathParts = window.location.pathname.split('/');
    let userId = null;
    for (let i = 0; i < pathParts.length; i++) {
        if (pathParts[i] === 'users' && i + 1 < pathParts.length) {
            userId = pathParts[i + 1];
            break;
        }
    }
    if (!userId) return;

    loadUserProfileInfo(userId);
    loadUserProfilePosts(userId);
    initAgeDetailCard();
}

function initAgeDetailCard() {
    const nameEl = document.getElementById('user-profile-name');
    const genderEl = document.getElementById('user-profile-gender');
    const ageEl = document.getElementById('user-profile-age');
    if (!nameEl && !genderEl && !ageEl) return;
}

let __profileCurrentUser = null;
let __profileUserId = null;

function __setProfileUser(u, uid) {
    __profileCurrentUser = u;
    __profileUserId = uid;
}

function __isProfileOwner() {
    return __profileUserId && UserId && String(__profileUserId) === String(UserId);
}

function __profileGenderText(g) {
    return g === 1 || g === "1" ? '男' : g === 2 || g === "2" ? '女' : '保密';
}

function __profileGenderIcon(g) {
    return g === 1 || g === "1" ? 'fa-mars' : g === 2 || g === "2" ? 'fa-venus' : 'fa-user';
}

function __profileAgeDisplay(age) {
    if (!age) return '保密';
    const s = String(age).trim();
    // yyyymmdd 格式
    if (/^\d{8}$/.test(s)) {
        const y = parseInt(s.substring(0, 4), 10);
        const m = parseInt(s.substring(4, 6), 10) - 1;
        const d = parseInt(s.substring(6, 8), 10);
        const dt = new Date(y, m, d);
        if (!isNaN(dt.getTime())) {
            const now = new Date();
            let a = now.getFullYear() - dt.getFullYear();
            const md = now.getMonth() - dt.getMonth();
            if (md < 0 || (md === 0 && now.getDate() < dt.getDate())) a--;
            return a + ' 岁';
        }
    }
    // 兼容纯数字年龄
    const n = parseInt(s, 10);
    if (!isNaN(n)) return n + ' 岁';
    return '保密';
}

function __profileDetailStyles() {
    return `
        <style>
            .age-detail-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--color-border-divider,#e5e7eb);font-size:14px;}
            .age-detail-row:last-child{border-bottom:none;}
            .age-detail-row .label{color:var(--color-text-secondary,#6b7280);}
            .age-detail-row .value{color:var(--color-text-primary,#1f2937);font-weight:500;}
            .age-detail-edit-btn{margin-left:auto;padding:4px 12px;font-size:13px;background:var(--color-primary,#3b82f6);color:#fff;border:none;border-radius:6px;cursor:pointer;transition:opacity 0.2s;float:right;}
            .age-detail-edit-btn:hover{opacity:0.85;}
            .age-detail-edit-group{margin-bottom:16px;}
            .age-detail-edit-group label{display:block;margin-bottom:8px;color:var(--color-text-secondary,#6b7280);font-size:14px;}
            .age-detail-edit-group input[type="date"],.age-detail-edit-group input[type="text"],.age-detail-edit-group textarea{width:100%;padding:8px 12px;border:1px solid var(--color-border-divider,#e5e7eb);border-radius:6px;background:var(--color-bg-card,#fff);color:var(--color-text-primary,#1f2937);font-size:14px;box-sizing:border-box;font-family:inherit;resize:vertical;}
            .gender-options{display:flex;gap:8px;}
            .gender-opt{flex:1;padding:8px 12px;border:1px solid var(--color-border-divider,#e5e7eb);background:var(--color-bg-card,#fff);color:var(--color-text-secondary,#6b7280);border-radius:6px;cursor:pointer;font-size:14px;transition:all 0.2s;}
            .gender-opt:hover{border-color:var(--color-primary,#3b82f6);color:var(--color-primary,#3b82f6);}
            .gender-opt.active{background:var(--color-primary,#3b82f6);color:#fff;border-color:var(--color-primary,#3b82f6);}
            .age-detail-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px;}
            .age-detail-cancel{padding:8px 20px;border-radius:6px;cursor:pointer;font-size:14px;border:none;background:var(--color-bg-item-hover,#f3f4f6);color:var(--color-text-secondary,#6b7280);transition:opacity 0.2s;}
            .age-detail-save{padding:8px 20px;border-radius:6px;cursor:pointer;font-size:14px;border:none;background:var(--color-primary,#3b82f6);color:#fff;transition:opacity 0.2s;}
            .age-detail-cancel:hover,.age-detail-save:hover{opacity:0.85;}
            .birthday-picker{display:flex;align-items:center;gap:6px;width:100%;}
            .birthday-picker .bp-arrow{width:32px;height:32px;border-radius:6px;border:1px solid var(--color-border-divider,#e5e7eb);background:var(--color-bg-card,#fff);color:var(--color-text-secondary,#6b7280);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;transition:all 0.15s;flex-shrink:0;}
            .birthday-picker .bp-arrow:hover{border-color:var(--color-primary,#3b82f6);color:var(--color-primary,#3b82f6);background:var(--color-bg-item-hover,rgba(59,130,246,0.08));}
            .birthday-picker .bp-arrow:active{transform:scale(0.92);}
            .birthday-picker .bp-year-wrap{position:relative;width:90px;height:36px;overflow:hidden;flex-shrink:0;}
            .birthday-picker .bp-year{width:100%;height:100%;text-align:center;border:1px solid var(--color-border-divider,#e5e7eb);border-radius:6px;background:var(--color-bg-card,#fff);color:var(--color-text-primary,#1f2937);font-size:14px;outline:none;-moz-appearance:textfield;appearance:textfield;}
            .birthday-picker .bp-year::-webkit-inner-spin-button,.birthday-picker .bp-year::-webkit-outer-spin-button{-webkit-appearance:none;margin:0;}
            .birthday-picker .bp-sep{color:var(--color-text-tertiary,#9ca3af);font-size:14px;flex-shrink:0;}
            .birthday-picker .bp-month,.birthday-picker .bp-day{width:56px;height:36px;text-align:center;border:1px solid var(--color-border-divider,#e5e7eb);border-radius:6px;background:var(--color-bg-card,#fff);color:var(--color-text-primary,#1f2937);font-size:14px;outline:none;-moz-appearance:textfield;appearance:textfield;}
            .birthday-picker .bp-month::-webkit-inner-spin-button,.birthday-picker .bp-month::-webkit-outer-spin-button,.birthday-picker .bp-day::-webkit-inner-spin-button,.birthday-picker .bp-day::-webkit-outer-spin-button{-webkit-appearance:none;margin:0;}
            .bp-year-anim{transition:transform 0.18s cubic-bezier(.4,0,.2,1),opacity 0.18s cubic-bezier(.4,0,.2,1);}
            .avatar-switch-row{display:flex;align-items:center;gap:8px;margin-top:8px;}
            .avatar-switch-text{font-size:12px;color:var(--color-text-tertiary,#9ca3af);}
            .avatar-switch-btn{padding:4px 10px;font-size:12px;color:var(--color-text-tertiary,#9ca3af);background:transparent;border:1px solid var(--color-border-divider,#e5e7eb);border-radius:4px;cursor:pointer;transition:all 0.2s;font-family:inherit;display:inline-flex;align-items:center;gap:4px;}
            .avatar-switch-btn:hover{color:var(--color-text-secondary,#6b7280);border-color:var(--color-text-tertiary,#9ca3af);background:var(--color-bg-item-hover,rgba(0,0,0,0.03));}
            .avatar-upload-area{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:20px 12px;border:1px dashed var(--color-border-divider,#e5e7eb);border-radius:6px;cursor:pointer;transition:all 0.2s;background:var(--color-bg-card,#fff);}
            .avatar-upload-area:hover{border-color:var(--color-text-tertiary,#9ca3af);}
            .avatar-upload-area i{font-size:24px;color:var(--color-text-tertiary,#9ca3af);}
            .avatar-upload-area span{font-size:13px;color:var(--color-text-secondary,#6b7280);}
            .avatar-upload-hint{font-size:11px !important;color:var(--color-text-tertiary,#9ca3af) !important;}
            .avatar-upload-preview{position:relative;display:flex;justify-content:center;margin:8px 0;}
            .avatar-upload-preview img{width:80px;height:80px;border-radius:50% !important;object-fit:cover !important;overflow:hidden !important;border:1px solid var(--color-border-divider,#e5e7eb);}
            .avatar-upload-cancel{position:absolute;top:-2px;right:calc(50% - 44px);width:20px;height:20px;border-radius:50%;border:none;background:var(--color-text-tertiary,#9ca3af);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:10px;transition:opacity 0.2s;}
            .avatar-upload-cancel:hover{opacity:0.8;}
        </style>
    `;
}

function ShowUserProfileDetail() {
    if (!__profileCurrentUser) return;
    const u = __profileCurrentUser;
    const gender = __profileGenderText(u.gender);
    const ageStr = __profileAgeDisplay(u.age);
    const joined = u.created_at ? new Date(u.created_at).toLocaleDateString('zh-CN') : '-';
    const lastLogin = u.last_login ? new Date(u.last_login).toLocaleDateString('zh-CN') : '-';
    const editBtn = __isProfileOwner()
        ? `<button class="age-detail-edit-btn" id="detail-edit-btn" onclick="ShowUserProfileEdit()"><i class="fa fa-pencil"></i> 编辑</button>` : '';

    UpdataWindowsCardWithCenterSreen(`
        ${__profileDetailStyles()}
        <h3><i class="fa fa-id-card-o"></i> 个人详情${editBtn}</h3>
        <div class="age-detail-row"><span class="label">用户名</span><span class="value user-name-clickable Username">${sanitizeUsernameHtml(u.name || '')}</span></div>
        <div class="age-detail-row"><span class="label">年龄</span><span class="value">${ageStr}</span></div>
        <div class="age-detail-row"><span class="label">性别</span><span class="value">${gender}</span></div>
        <div class="age-detail-row"><span class="label">注册时间</span><span class="value">${joined}</span></div>
        <div class="age-detail-row"><span class="label">最后登录</span><span class="value">${lastLogin}</span></div>
    `);
}

function ClickUserProfileAge() {
    if (!__profileCurrentUser) return;
    ShowUserProfileDetail();
}

function ShowUserProfileEdit() {
    if (!__profileCurrentUser) return;
    const u = __profileCurrentUser;
    const g = u.gender;
    __editSelectedGender = null;
    const rawAge = u.age || '';
    let bpYear = new Date().getFullYear(), bpMonth = 1, bpDay = 1;
    const s = String(rawAge).trim();
    if (/^\d{8}$/.test(s)) {
        bpYear = parseInt(s.substring(0, 4), 10);
        bpMonth = parseInt(s.substring(4, 6), 10);
        bpDay = parseInt(s.substring(6, 8), 10);
    }
    UpdataWindowsCardWithCenterSreen(`
        ${__profileDetailStyles()}
        <h3><i class="fa fa-pencil"></i> 编辑信息</h3>
        <div class="age-detail-edit-group">
            <label>头像</label>
            <div class="avatar-edit-panel" id="avatar-url-panel">
                <input type="text" id="edit-avatar" placeholder="输入头像图片URL" />
                <div class="avatar-switch-row">
                    <span class="avatar-switch-text">或</span>
                    <button type="button" class="avatar-switch-btn" onclick="__switchAvatarTab('upload')"><i class="fa fa-upload"></i> 上传本地图片</button>
                </div>
            </div>
            <div class="avatar-edit-panel" id="avatar-upload-panel" style="display:none;">
                <div class="avatar-upload-area" id="avatar-upload-area" onclick="document.getElementById('avatar-file-input').click()">
                    <i class="fa fa-cloud-upload"></i>
                    <span>点击选择图片</span>
                    <span class="avatar-upload-hint">支持 JPG/PNG/WebP，将压缩为400x400</span>
                </div>
                <input type="file" id="avatar-file-input" accept="image/*" style="display:none;" onchange="__handleAvatarUpload(this)" />
                <div class="avatar-upload-preview" id="avatar-upload-preview" style="display:none;">
                    <img id="avatar-upload-preview-img" src="" alt="预览" />
                    <button class="avatar-upload-cancel" onclick="__cancelAvatarUpload()"><i class="fa fa-times"></i></button>
                </div>
                <div class="avatar-switch-row">
                    <button type="button" class="avatar-switch-btn" onclick="__switchAvatarTab('url')"><i class="fa fa-link"></i> 使用URL</button>
                </div>
            </div>
        </div>
        <div class="age-detail-edit-group">
            <label>用户名</label>
            <input type="text" id="edit-username" />
        </div>
        <div class="age-detail-edit-group">
            <label>简介</label>
            <textarea id="edit-intro" rows="3" placeholder="这个人很懒，什么都没留下~"></textarea>
        </div>
        <div class="age-detail-edit-group">
            <label>性别</label>
            <div class="gender-options" id="gender-options">
                <button class="gender-opt ${g == 1 ? 'active' : ''}" data-gender="1" onclick="__selectGenderEdit(1, this)"><i class="fa fa-mars"></i> 男</button>
                <button class="gender-opt ${g == 2 ? 'active' : ''}" data-gender="2" onclick="__selectGenderEdit(2, this)"><i class="fa fa-venus"></i> 女</button>
                <button class="gender-opt ${g != 1 && g != 2 ? 'active' : ''}" data-gender="0" onclick="__selectGenderEdit(0, this)"><i class="fa fa-user"></i> 保密</button>
            </div>
        </div>
        <div class="age-detail-edit-group">
            <label>出生日期</label>
            <div class="birthday-picker" id="birthday-picker">
                <button class="bp-arrow" onclick="__bpYearStep(-1)" title="上一年"><i class="fa fa-chevron-left"></i></button>
                <div class="bp-year-wrap">
                    <input type="number" class="bp-year bp-year-anim" id="bp-year" value="${bpYear}" />
                </div>
                <button class="bp-arrow" onclick="__bpYearStep(1)" title="下一年"><i class="fa fa-chevron-right"></i></button>
                <span class="bp-sep">-</span>
                <input type="number" class="bp-month" id="bp-month" value="${bpMonth}" min="1" max="12" />
                <span class="bp-sep">-</span>
                <input type="number" class="bp-day" id="bp-day" value="${bpDay}" min="1" max="31" />
            </div>
        </div>
        <div class="age-detail-actions">
            <button class="age-detail-cancel" onclick="ShowUserProfileDetail()">取消</button>
            <button class="age-detail-save" onclick="SaveUserProfileEdit()">保存</button>
        </div>
    `);
    const nameInput = document.getElementById('edit-username');
    if (nameInput) nameInput.value = u.name || '';
    const introInput = document.getElementById('edit-intro');
    if (introInput) introInput.value = u.intro || '';
    const avatarInput = document.getElementById('edit-avatar');
    if (avatarInput) avatarInput.value = u.avatar || '';
    const bpYearInput = document.getElementById('bp-year');
    if (bpYearInput) {
        bpYearInput.addEventListener('blur', function() {
            const val = this.value.trim();
            if (/^\d{3}$/.test(val)) {
                this.value = '0' + val;
            }
        });
    }
}

let __avatarUploadedUrl = null;

function __switchAvatarTab(tab) {
    document.querySelectorAll('.avatar-edit-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('avatar-url-panel').style.display = tab === 'url' ? 'block' : 'none';
    document.getElementById('avatar-upload-panel').style.display = tab === 'upload' ? 'block' : 'none';
}

function __handleAvatarUpload(input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
        alert('图片大小不能超过10MB');
        input.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
        const preview = document.getElementById('avatar-upload-preview');
        const previewImg = document.getElementById('avatar-upload-preview-img');
        const uploadArea = document.getElementById('avatar-upload-area');
        previewImg.src = e.target.result;
        preview.style.display = 'flex';
        uploadArea.style.display = 'none';
    };
    reader.readAsDataURL(file);
    __uploadAvatarFile(file);
}

function __uploadAvatarFile(file) {
    const formData = new FormData();
    formData.append('avatar', file);
    const uploadArea = document.getElementById('avatar-upload-area');
    if (uploadArea) {
        uploadArea.innerHTML = '<i class="fa fa-spinner fa-spin"></i><span>上传中...</span>';
        uploadArea.style.display = 'flex';
    }
    document.getElementById('avatar-upload-preview').style.display = 'none';
    apiFetch('/api/user/avatar/upload', {
        method: 'POST',
        body: formData
    })
    .then(r => r.json())
    .then(data => {
        if (data.success && data.avatar) {
            __avatarUploadedUrl = data.avatar;
            const preview = document.getElementById('avatar-upload-preview');
            const previewImg = document.getElementById('avatar-upload-preview-img');
            previewImg.src = data.avatar;
            preview.style.display = 'flex';
            if (uploadArea) uploadArea.style.display = 'none';
            const urlInput = document.getElementById('edit-avatar');
            if (urlInput) urlInput.value = data.avatar;
        } else {
            alert(data.message || '上传失败');
            __cancelAvatarUpload();
        }
    })
    .catch(() => {
        alert('网络错误，上传失败');
        __cancelAvatarUpload();
    });
}

function __cancelAvatarUpload() {
    __avatarUploadedUrl = null;
    const input = document.getElementById('avatar-file-input');
    if (input) input.value = '';
    const preview = document.getElementById('avatar-upload-preview');
    const uploadArea = document.getElementById('avatar-upload-area');
    if (preview) preview.style.display = 'none';
    if (uploadArea) {
        uploadArea.style.display = 'flex';
        uploadArea.innerHTML = '<i class="fa fa-cloud-upload"></i><span>点击选择图片</span><span class="avatar-upload-hint">支持 JPG/PNG/WebP，将压缩为400x400</span>';
    }
}

let __editSelectedGender = null;

function __selectGenderEdit(val, btn) {
    __editSelectedGender = val;
    document.querySelectorAll('.gender-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

function __bpYearStep(delta) {
    const el = document.getElementById('bp-year');
    if (!el) return;
    const cur = parseInt(el.value, 10) || 0;
    const next = cur + delta;
    // 滚动动画
    el.classList.remove('bp-year-anim');
    const dir = delta > 0 ? -1 : 1;
    el.style.transform = `translateY(${dir * 12}px)`;
    el.style.opacity = '0';
    void el.offsetWidth; // 强制回流
    el.classList.add('bp-year-anim');
    el.value = next;
    el.style.transform = `translateY(${-dir * 12}px)`;
    requestAnimationFrame(() => {
        el.style.transform = '';
        el.style.opacity = '';
    });
}

function __bpGetDate() {
    const yEl = document.getElementById('bp-year');
    const mEl = document.getElementById('bp-month');
    const dEl = document.getElementById('bp-day');
    const y = yEl ? parseInt(yEl.value, 10) : 0;
    const m = mEl ? parseInt(mEl.value, 10) : 1;
    const d = dEl ? parseInt(dEl.value, 10) : 1;
    if (isNaN(y) || isNaN(m) || isNaN(d)) return '';
    return `${String(y).padStart(4, '0')}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

function SaveUserProfileEdit() {
    const nameEl = document.getElementById('edit-username');
    const nameVal = nameEl ? nameEl.value.trim() : '';
    const introEl = document.getElementById('edit-intro');
    const introVal = introEl ? introEl.value.trim() : '';
    const avatarEl = document.getElementById('edit-avatar');
    const avatarVal = avatarEl ? avatarEl.value.trim() : '';
    const bpDate = __bpGetDate();
    const hasGender = __editSelectedGender !== undefined && __editSelectedGender !== null;
    const hasAge = !!bpDate;
    const hasName = !!nameVal && nameVal !== (__profileCurrentUser ? __profileCurrentUser.name : '');
    const hasIntro = introVal !== (__profileCurrentUser ? (__profileCurrentUser.intro || '') : '');
    const hasAvatar = !!avatarVal && avatarVal !== (__profileCurrentUser ? (__profileCurrentUser.avatar || '') : '');
    if (hasName) {
        const nameNoEgg = stripEasterEgg(nameVal);
        if (nameNoEgg.length < 2 || nameNoEgg.length > 20) {
            alert('用户名需要2-20个字符（不含彩蛋）');
            return;
        }
    }
    if (!hasGender && !hasAge && !hasName && !hasIntro && !hasAvatar) {
        alert('未修改任何内容');
        return;
    }
    const tasks = [];
    if (hasAvatar) {
        tasks.push({ avatar: avatarVal });
    }
    if (hasName) {
        tasks.push({ Name: nameVal });
    }
    if (hasIntro) {
        tasks.push({ intro: introVal });
    }
    if (hasGender) {
        tasks.push({ gender: parseInt(__editSelectedGender, 10) });
    }
    if (hasAge) {
        tasks.push({ age: bpDate });
    }
    const doNext = (idx) => {
        if (idx >= tasks.length) {
            if (__profileCurrentUser) {
                const namePageEl = document.getElementById('user-profile-name');
                const genderEl = document.getElementById('user-profile-gender');
                const ageEl = document.getElementById('user-profile-age');
                const introPageEl = document.getElementById('user-profile-intro');
                const avatarPageEl = document.getElementById('user-profile-avatar-img');
                if (namePageEl) {
                    setUsernameElement(namePageEl, __profileCurrentUser.name || '');
                }
                if (genderEl) {
                    genderEl.innerHTML = `<i class="fa ${__profileGenderIcon(__profileCurrentUser.gender)}"></i> ${__profileGenderText(__profileCurrentUser.gender)}`;
                }
                if (ageEl) {
                    ageEl.innerHTML = `<i class="fa fa-birthday-cake"></i> ${__profileAgeDisplay(__profileCurrentUser.age)}`;
                }
                if (introPageEl) {
                    introPageEl.textContent = __profileCurrentUser.intro ? __profileCurrentUser.intro : '这个人很懒，什么都没留下~';
                }
                if (avatarPageEl && hasAvatar) {
                    avatarPageEl.src = __profileCurrentUser.avatar;
                }
                const headerNameEl = document.getElementById('user-name');
                if (headerNameEl && hasName) {
                    setUsernameElement(headerNameEl, __profileCurrentUser.name || '');
                }
                const headerAvatarEl = document.getElementById('user-avatar');
                if (headerAvatarEl && hasAvatar) {
                    const headerImg = headerAvatarEl.querySelector('img');
                    if (headerImg) headerImg.src = __profileCurrentUser.avatar;
                }
                ShowUserProfileDetail();
            }
            return;
        }
        const Info = tasks[idx];
        apiFetch('/api/users/change', {
            method: 'POST',
            body: JSON.stringify({ Info })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                if (__profileCurrentUser) {
                    for (const k in Info) {
                        if (k === 'Name') __profileCurrentUser.name = Info[k];
                        else __profileCurrentUser[k.toLowerCase()] = Info[k];
                    }
                }
                doNext(idx + 1);
            } else {
                alert(data.message || '保存失败');
            }
        })
        .catch(() => alert('网络错误'));
    };
    doNext(0);
}

function loadUserProfileInfo(userId) {
    const nameEl = document.getElementById('user-profile-name');
    const prefixBadgeEl = document.getElementById('user-prefix-badge');
    const vipLabelEl = document.getElementById('user-vip-label');
    const avatarEl = document.getElementById('user-profile-avatar-img');
    const introEl = document.getElementById('user-profile-intro');
    const genderEl = document.getElementById('user-profile-gender');
    const ageEl = document.getElementById('user-profile-age');
    const postCountEl = document.getElementById('user-post-count');
    const totalLikesEl = document.getElementById('user-total-likes');
    const totalViewsEl = document.getElementById('user-total-views');

    apiFetch(`/api/users/${userId}/info`)
        .then(res => {
            const needLogin = res.status === 401;
            return res.json().then(data => {
                data.__needLogin = needLogin || (data.message && /登录/.test(data.message));
                return data;
            });
        })
        .then(data => {
            if (!data.success) {
                if (data.__needLogin) {
                    // 真的是需要登录：清本地假登录态并跳转
                    UserId = undefined;
                    try { sessionStorage.removeItem('userInfo'); } catch(_) {}
                    try { document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax;'; } catch(_) {}
                    window.location.href = "/login";
                    return;
                }
                // 其他错误（用户不存在/被删除等）只显示提示，不跳登录 — 避免用户不存在时被误送登录页
                if (nameEl) nameEl.innerText = data.message || '用户不存在';
                return;
            }
            const user = data.user;
            const stats = data.stats;

            if (avatarEl) avatarEl.src = user.avatar;
            if (nameEl) setUsernameElement(nameEl, user.name);

            if (prefixBadgeEl) {
                prefixBadgeEl.className = 'prefix-badge';
                prefixBadgeEl.innerHTML = '';
                const userId = user.id || '';
                const prefix = userId.substring(0, 2).toUpperCase();
                const rest = userId.substring(2);
                const isSpecial = prefix === 'HG' && /^0+$/.test(rest);
                let bgColor = null;
                if (isSpecial) {
                    bgColor = '#6366f1';
                } else if (prefix === 'HG') {
                    bgColor = '#3b82f6';
                } else if (prefix === 'YJ') {
                    bgColor = '#f59e0b';
                }
                if (bgColor) {
                    prefixBadgeEl.innerHTML = `
                        <svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="11" cy="11" r="11" fill="${bgColor}"/>
                            <path d="M11 15L6 7H8L11 11L14 7H16L11 15Z" fill="white"/>
                        </svg>
                    `;
                }
            }

            if (introEl) {
                introEl.textContent = user.intro ? user.intro : '这个人很懒，什么都没留下~';
            }

            if (genderEl) {
                const g = user.gender;
                const gText = g === 1 || g === "1" ? '男' : g === 2 || g === "2" ? '女' : '保密';
                const gIcon = g === 1 || g === "1" ? 'fa-mars' : g === 2 || g === "2" ? 'fa-venus' : 'fa-user';
                genderEl.innerHTML = `<i class="fa ${gIcon}"></i> ${gText}`;
            }

            if (ageEl) {
                ageEl.innerHTML = `<i class="fa fa-birthday-cake"></i> ${__profileAgeDisplay(user.age)}`;
            }

            if (vipLabelEl) {
                console.log('VIP label found, user.vip:', user.vip, typeof user.vip);
                if (user.vip && user.vip !== '0') {
                    vipLabelEl.style.backgroundImage = 'url(https://op-kdocs.wpscdn.cn/odimg/web/2024-03-26-12-26/vipnew_hover.svg)';
                } else {
                    vipLabelEl.style.backgroundImage = 'url(https://op-kdocs.wpscdn.cn/odimg/web/2024-03-26-12-22/vipnormal_gray.svg)';
                }
            } else {
                console.log('VIP label element not found');
            }

            if (postCountEl && stats) postCountEl.innerText = stats.post_count;
            if (totalLikesEl && stats) totalLikesEl.innerText = stats.total_likes;
            if (totalViewsEl && stats) totalViewsEl.innerText = stats.total_views;

            const followStats = data.follow_stats;
            const followingEl = document.getElementById('user-following-count');
            const followerEl = document.getElementById('user-follower-count');
            if (followingEl && followStats) followingEl.innerText = followStats.following_count;
            if (followerEl && followStats) followerEl.innerText = followStats.follower_count;

            const followBtnEl = document.getElementById('user-follow-btn');
            if (followBtnEl) {
                if (data.is_self) {
                    followBtnEl.style.display = 'none';
                } else {
                    followBtnEl.style.display = '';
                    if (data.is_following) {
                        followBtnEl.classList.add('following');
                        followBtnEl.innerHTML = '<i class="fa fa-check"></i> 已关注';
                    } else {
                        followBtnEl.classList.remove('following');
                        followBtnEl.innerHTML = '<i class="fa fa-plus"></i> 关注';
                    }
                    followBtnEl.onclick = function() { toggleFollowUser(userId); };
                }
            }

            if (typeof __setProfileUser === 'function') {
                __setProfileUser(user, userId);
            }
        })
        .catch(err => {
            console.error('加载用户信息失败:', err);
            if (nameEl) nameEl.innerText = '加载失败';
        });
}

function loadUserProfilePosts(userId) {
    const postsListEl = document.getElementById('user-posts-list');
    if (!postsListEl) return;

    postsListEl.innerHTML = '<p class="loading-text">加载中...</p>';

    apiFetch(`/api/users/${userId}/posts?page=1&page_size=20`)
        .then(res => res.json())
        .then(data => {
            if (!data.success) {
                postsListEl.innerHTML = '<p class="empty-text">加载失败</p>';
                return;
            }
            const posts = data.posts;
            if (!posts || posts.length === 0) {
                postsListEl.innerHTML = '<p class="empty-text">暂无帖子</p>';
                return;
            }

            postsListEl.innerHTML = '';
            posts.forEach(post => {
                const postEl = document.createElement('div');
                postEl.className = 'post-item';
                postEl.style.cursor = 'pointer';
                postEl.onclick = () => { window.location.href = `/post/${post.id}`; };

                const createdDate = post.created_at ? new Date(post.created_at) : null;
                const dateStr = createdDate ?
                    `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(2, '0')}-${String(createdDate.getDate()).padStart(2, '0')}` : '-';

                const categoryMap = {
                    'general': '综合',
                    'discussion': '讨论',
                    'share': '分享',
                    'question': '提问',
                    'tutorial': '教程'
                };
                const categoryText = categoryMap[post.category] || post.category || '综合';

                postEl.innerHTML = `
                    <h3 class="post-item-title">${escapeHtml(post.title)}</h3>
                    <p class="post-item-summary">${escapeHtml(post.summary || '')}</p>
                    <div class="post-item-footer">
                        <span class="post-item-category">${categoryText}</span>
                        <div class="post-item-stats">
                            <span><i class="fa fa-eye"></i> ${post.views || 0}</span>
                            <span><i class="fa fa-thumbs-up"></i> ${post.likes || 0}</span>
                            <span><i class="fa fa-clock-o"></i> ${dateStr}</span>
                        </div>
                    </div>
                `;
                postsListEl.appendChild(postEl);
            });
        })
        .catch(err => {
            console.error('加载用户帖子失败:', err);
            postsListEl.innerHTML = '<p class="empty-text">加载失败</p>';
        });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
}

function sanitizeHtml(html) {
    if (!html) return '';
    let clean = html;
    const temp = document.createElement('textarea');
    temp.innerHTML = clean;
    clean = temp.value;
    clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    clean = clean.replace(/<script\b[^>]*>/gi, '');
    clean = clean.replace(/<\/script>/gi, '');
    clean = clean.replace(/<(script|style|iframe|embed|object|applet|base|form|input|textarea|select|option|button)\b[^>]*>/gi, '');
    clean = clean.replace(/<\/(script|style|iframe|embed|object|applet|base|form|input|textarea|select|option|button)>/gi, '');
    clean = clean.replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '');
    clean = clean.replace(/\bon\w+\s*=\s*[^>\s]+/gi, '');
    clean = clean.replace(/javascript\s*:/gi, '');
    clean = clean.replace(/<link\b[^>]*>/gi, '');
    clean = clean.replace(/<meta\b[^>]*>/gi, '');
    return clean;
}

function addCopyButtons() {
    const mdEl = document.getElementById('Markdown');
    if (!mdEl) return;
    const pres = mdEl.querySelectorAll('pre');
    pres.forEach(pre => {
        const btn = document.createElement('button');
        btn.className = 'md-copy-btn';
        btn.innerText = '复制';
        btn.addEventListener('click', function() {
            const code = pre.querySelector('code');
            const text = code ? code.innerText : pre.innerText;
            navigator.clipboard.writeText(text).then(() => {
                btn.innerText = '已复制';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.innerText = '复制';
                    btn.classList.remove('copied');
                }, 2000);
            }).catch(() => {
                btn.innerText = '失败';
                setTimeout(() => {
                    btn.innerText = '复制';
                }, 2000);
            });
        });
        pre.appendChild(btn);
    });
}




// 格式化当前时间函数 YYYY-MM-DD HH:mm:ss
function formatNowTime() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 缓存时间节点，避免每次全局遍历
let timeElementCache = null;
let timeUpdatePending = false;

function refreshTimeCache() {
    timeElementCache = document.querySelectorAll('.TimeWithUserNameAPI');
}

// 更新所有匹配元素
function updateTimeElements() {
    if (!timeElementCache) refreshTimeCache();
    const nowStr = formatNowTime();
    timeElementCache.forEach(el => el.textContent = nowStr);
}

// 初始化缓存并立即渲染
refreshTimeCache();
updateTimeElements();

// 每秒定时刷新所有元素
const timeTimer = setInterval(updateTimeElements, 1000);

// MutationObserver 监听DOM新增，耗时代码异步延后执行
const observer = new MutationObserver(mutations => {
    let needUpdate = false;
    for (const mut of mutations) {
        if (mut.addedNodes.length) {
            needUpdate = true;
            break;
        }
    }
    if (!needUpdate || timeUpdatePending) return;

    timeUpdatePending = true;
    // 放入异步宏任务，让出主线程
    setTimeout(() => {
        refreshTimeCache();
        updateTimeElements();
        timeUpdatePending = false;
    }, 0);
});

observer.observe(document.documentElement, {
    childList: true,
    subtree: true
});

// 页面卸载销毁资源
window.addEventListener('beforeunload', () => {
    clearInterval(timeTimer);
    observer.disconnect();
});

// Live2D 入口卡片：随机选择一个动作 GIF 展示
(function() {
    const gifs = ['待机', '嘿咻', '惊醒', '起跳', '铁片'];
    function pickRandomLive2DGif() {
        const img = document.getElementById('live2d-card-gif');
        if (!img) return;
        const pick = gifs[Math.floor(Math.random() * gifs.length)];
        img.src = `//assets.crazying-dev.top/text/one/Live2D/GIF/${encodeURIComponent(pick)}.gif`;
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', pickRandomLive2DGif);
    } else {
        pickRandomLive2DGif();
    }
})();


function UpdataUserProfileGender(NEW){
    if (["0", "1", "2"].includes(NEW)){
        apiFetch("/api/users/change",{
            method: 'POST',
            headers: { 'Accept': 'application/json' },
            body: JSON.stringify({
                'Info': {
                    "gender": NEW
                }
            })
        })
            .then(res => res.json())
            .then(data => {
                console.log(data);
                if (data["success"] === true) {
                    initMouseLinuxPage();
                }else{
                    console.error(data.get("message") ?? "");
                }
            })
    }
}


function Action(){
    const worldInput = document.getElementById('world-chat-input');
    if (worldInput) {
        worldInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                SendWorldMessage();
            }
        });
    }
    const worldDom = document.getElementById('WorldMessageDOM');
    if (worldDom) {
        worldDom.addEventListener('click', function(e) {
            const btn = e.target.closest('.world-msg-reply-btn');
            if (btn) {
                const msgId = btn.dataset.msgId;
                const msgEl = worldDom.querySelector(`.world-msg[data-msg-id="${msgId}"]`);
                if (msgEl) {
                    const nameEl = msgEl.querySelector('.world-msg-name');
                    const name = nameEl ? nameEl.textContent.trim() : '匿名';
                    __setWorldReply(msgId, name);
                }
            }
        });
        const cached = __worldLoadMessages();
        if (cached && cached.length > 0) {
            WriteInWorldDom(cached);
        }
    }
    const searchInput = document.getElementById('search_input');
    const searchBtn = document.getElementById('search_button');
    if (searchInput && searchBtn) {
        const isMobile = function() { return window.innerWidth <= 500; };
        const doSearch = function() {
            const kw = searchInput.value.trim();
            if (kw) {
                window.location.href = '/search?k=' + encodeURIComponent(kw);
            } else if (isMobile()) {
                window.location.href = '/search';
            }
        };
        searchBtn.addEventListener('click', function(e) {
            if (isMobile()) {
                e.preventDefault();
                doSearch();
                return;
            }
            doSearch();
        });
        searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                doSearch();
            }
            if (e.key === 'Escape') {
                searchInput.blur();
            }
        });
    }
}

let genderInitDone = false;
function initGenderSelect() {
    if (genderInitDone) return;
    const wrapper = document.querySelector('.gender-selector-wrapper');
    if (!wrapper) return;
    genderInitDone = true;
    window.getSelectedGender = function () {
        const selectedRadio = wrapper.querySelector('input[name="gender-selector-gender"]:checked');
        if (!selectedRadio) return null;
        UpdataUserProfileGender(selectedRadio.value);
    }
}

function GenderCardToYes() {
    initGenderSelect();
    if (window.getSelectedGender) getSelectedGender();
}

let WroldALL = null;
let __worldChatActive = false;
let __worldLastSendTime = 0;
let __worldAvatarCache = {};
let __worldAvatarLoading = {};
let __worldInactiveTimer = null;
let __worldIdleMode = false;
let __worldWarned = false;
let __worldLastActivity = 0;
let __worldBanned = false;
let __worldPageHidden = false;

const __WORLD_SEND_INTERVAL = 2000;
const __WORLD_IDLE_THRESHOLD = 2 * 60 * 1000;
const __WORLD_BAN_THRESHOLD = 10 * 60 * 1000;
const __WORLD_POLL_NORMAL = 3000;
const __WORLD_POLL_IDLE = 15000;
const __WORLD_LOCAL_STORAGE_KEY = 'fairy_world_messages';

function __worldSaveMessages(messages) {
    try {
        localStorage.setItem(__WORLD_LOCAL_STORAGE_KEY, JSON.stringify(messages));
    } catch (e) {}
}

function __worldLoadMessages() {
    try {
        const stored = localStorage.getItem(__WORLD_LOCAL_STORAGE_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {}
    return null;
}

function __getWorldAvatar(senderId, callback) {
    if (!senderId) { callback(null); return; }
    if (__worldAvatarCache[senderId] !== undefined) { callback(__worldAvatarCache[senderId]); return; }
    if (__worldAvatarLoading[senderId]) {
        const check = setInterval(() => {
            if (__worldAvatarCache[senderId] !== undefined) {
                clearInterval(check);
                callback(__worldAvatarCache[senderId]);
            }
        }, 50);
        setTimeout(() => clearInterval(check), 5000);
        return;
    }
    __worldAvatarLoading[senderId] = true;
    apiFetch(`/api/users/${senderId}/info`)
        .then(res => res.json())
        .then(data => {
            const avatar = (data && data.user && data.user.avatar) ? data.user.avatar : null;
            __worldAvatarCache[senderId] = avatar;
            delete __worldAvatarLoading[senderId];
            callback(avatar);
        })
        .catch(() => {
            __worldAvatarCache[senderId] = null;
            delete __worldAvatarLoading[senderId];
            callback(null);
        });
}

function OpenTheWorld() {
    if (__worldBanned) {
        __showWorldBannedCard();
        return;
    }
    __showWorldWarningCard();
}

function __showWorldWarningCard() {
    UpdataWindowsCardWithCenterSreen(`
<div style="padding:8px 4px 4px; text-align:center;">
    <div style="font-size:28px; margin-bottom:12px;">
        <i class="fa fa-exclamation-triangle" style="color:var(--color-text-accent);"></i>
    </div>
    <div style="font-size:18px; color:var(--color-text-primary); margin-bottom:12px; letter-spacing:2px;">世界频道使用须知</div>
    <div style="font-size:14px; color:var(--color-text-tertiary); line-height:1.8; margin-bottom:18px; text-align:left; padding:0 8px;">
        请节约使用世界频道，长时间挂机会被检测并暂时禁用此功能。<br>
        · 2分钟无操作将自动降频<br>
        · 10分钟挂机将被禁用<br>
        · 页面隐藏时自动暂停获取
    </div>
    <div style="display:flex; gap:10px; justify-content:center;">
        <button onclick="ShowOrhidenWindowsCardWithCenterSreen(0)" style="padding:8px 20px; border:1px solid var(--color-border-card); background:transparent; color:var(--color-text-secondary); border-radius:8px; cursor:pointer; font-family:inherit; font-size:14px;">取消</button>
        <button onclick="__confirmEnterWorld()" style="padding:8px 20px; background:var(--color-primary); color:#fff; border:none; border-radius:8px; cursor:pointer; font-family:inherit; font-size:14px;">我已知晓，进入</button>
    </div>
</div>
`);
}

function __showWorldIdleCard() {
    UpdataWindowsCardWithCenterSreen(`
<div style="padding:8px 4px 4px; text-align:center;">
    <div style="font-size:28px; margin-bottom:12px;">
        <i class="fa fa-coffee" style="color:var(--color-text-tertiary);"></i>
    </div>
    <div style="font-size:18px; color:var(--color-text-primary); margin-bottom:12px; letter-spacing:2px;">已进入节能模式</div>
    <div style="font-size:14px; color:var(--color-text-tertiary); line-height:1.8; margin-bottom:18px;">
        检测到您长时间未操作，已降低消息刷新频率。<br>
        点击任意位置即可恢复正常。
    </div>
    <button onclick="ShowOrhidenWindowsCardWithCenterSreen(0)" style="padding:8px 20px; background:var(--color-primary); color:#fff; border:none; border-radius:8px; cursor:pointer; font-family:inherit; font-size:14px;">知道了</button>
</div>
`);
}

function __showWorldBannedCard() {
    UpdataWindowsCardWithCenterSreen(`
<div style="padding:8px 4px 4px; text-align:center;">
    <div style="font-size:28px; margin-bottom:12px;">
        <i class="fa fa-ban" style="color:#ef4444;"></i>
    </div>
    <div style="font-size:18px; color:var(--color-text-primary); margin-bottom:12px; letter-spacing:2px;">功能已被禁用</div>
    <div style="font-size:14px; color:var(--color-text-tertiary); line-height:1.8; margin-bottom:18px;">
        检测到长时间挂机，世界频道已被暂时禁用。<br>
        请刷新页面后重新进入。
    </div>
    <button onclick="location.reload()" style="padding:8px 20px; background:var(--color-primary); color:#fff; border:none; border-radius:8px; cursor:pointer; font-family:inherit; font-size:14px;">刷新页面</button>
</div>
`);
}

function __confirmEnterWorld() {
    ShowOrhidenWindowsCardWithCenterSreen(0);
    ToggleWorldChat();
}

function __worldKickActivity() {
    __worldLastActivity = Date.now();
    if (__worldBanned) return;
    if (__worldIdleMode) {
        __worldIdleMode = false;
        __worldWarned = false;
        __worldRestartPolling();
        const statusEl = document.getElementById('world-chat-status');
        if (statusEl) { statusEl.textContent = '已连接'; statusEl.style.color = 'var(--color-success,#10b981)'; }
    }
}

function __worldCheckIdle() {
    if (__worldBanned) return;
    const elapsed = Date.now() - __worldLastActivity;
    if (elapsed >= __WORLD_BAN_THRESHOLD) {
        __worldBanned = true;
        __worldStopAll();
        __showWorldBannedCard();
        return;
    }
    if (elapsed >= __WORLD_IDLE_THRESHOLD && !__worldIdleMode) {
        __worldIdleMode = true;
        if (WroldALL) clearInterval(WroldALL);
        WroldALL = setInterval(FetchWorldMessages, __WORLD_POLL_IDLE);
        const statusEl = document.getElementById('world-chat-status');
        if (statusEl) { statusEl.textContent = '节能模式'; statusEl.style.color = 'var(--color-text-tertiary,#9ca3af)'; }
        if (!__worldWarned) {
            __worldWarned = true;
            __showWorldIdleCard();
        }
    }
}

function __worldStopAll() {
    __worldChatActive = false;
    if (WroldALL) {
        clearInterval(WroldALL);
        WroldALL = null;
    }
    if (__worldInactiveTimer) {
        clearInterval(__worldInactiveTimer);
        __worldInactiveTimer = null;
    }
    const btn = document.getElementById('world-chat-toggle');
    const statusEl = document.getElementById('world-chat-status');
    const sendBtn = document.getElementById('world-chat-send');
    if (btn) {
        btn.textContent = '开始获取';
        btn.setAttribute('onclick', 'OpenTheWorld()');
    }
    if (statusEl) { statusEl.textContent = '已断开'; statusEl.style.color = 'var(--color-text-tertiary,#9ca3af)'; }
    if (sendBtn) sendBtn.disabled = true;
}

function __worldRestartPolling() {
    if (!__worldChatActive) return;
    if (__worldPageHidden) return;
    if (WroldALL) {
        clearInterval(WroldALL);
        WroldALL = null;
    }
    WroldALL = setInterval(FetchWorldMessages, __worldIdleMode ? __WORLD_POLL_IDLE : __WORLD_POLL_NORMAL);
}

function ToggleWorldChat() {
    const btn = document.getElementById('world-chat-toggle');
    const statusEl = document.getElementById('world-chat-status');
    const sendBtn = document.getElementById('world-chat-send');
    if (__worldChatActive) {
        __worldStopAll();
        if (btn) btn.setAttribute('onclick', 'OpenTheWorld()');
    } else {
        if (__worldBanned) {
            __showWorldBannedCard();
            return;
        }
        __worldChatActive = true;
        __worldLastActivity = Date.now();
        __worldIdleMode = false;
        __worldWarned = false;
        if (btn) {
            btn.textContent = '停止获取';
            btn.setAttribute('onclick', 'ToggleWorldChat()');
        }
        if (statusEl) { statusEl.textContent = '已连接'; statusEl.style.color = 'var(--color-success,#10b981)'; }
        if (sendBtn && typeof UserId !== 'undefined' && UserId) sendBtn.disabled = false;
        __worldRestartPolling();
        if (!__worldInactiveTimer) {
            __worldInactiveTimer = setInterval(__worldCheckIdle, 30000);
        }
        if (!__worldPageListenerBound) {
            __worldBindPageListeners();
        }
        if (!__worldActivityListenerBound) {
            __worldBindActivityListeners();
        }
    }
}

let __worldPageListenerBound = false;
let __worldActivityListenerBound = false;

function __worldBindPageListeners() {
    __worldPageListenerBound = true;
    document.addEventListener('visibilitychange', function() {
        if (!__worldChatActive) return;
        if (document.hidden) {
            __worldPageHidden = true;
            if (WroldALL) {
                clearInterval(WroldALL);
                WroldALL = null;
            }
            const statusEl = document.getElementById('world-chat-status');
            if (statusEl) { statusEl.textContent = '已暂停'; statusEl.style.color = 'var(--color-text-tertiary,#9ca3af)'; }
        } else {
            __worldPageHidden = false;
            __worldKickActivity();
            const statusEl = document.getElementById('world-chat-status');
            if (statusEl) {
                if (__worldIdleMode) { statusEl.textContent = '节能模式'; statusEl.style.color = 'var(--color-text-tertiary,#9ca3af)'; }
                else { statusEl.textContent = '已连接'; statusEl.style.color = 'var(--color-success,#10b981)'; }
            }
            if (!__worldIdleMode) {
                __worldRestartPolling();
            }
        }
    });
}

function __worldBindActivityListeners() {
    __worldActivityListenerBound = true;
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'focus'];
    events.forEach(function(evt) {
        document.addEventListener(evt, function() {
            if (__worldChatActive) __worldKickActivity();
        }, true);
    });
}

function FetchWorldMessages() {
    apiFetch('/api/World/ALL')
        .then(res => res.json())
        .then(data => { WriteInWorldDom(data); })
        .catch(() => {});
}

let __worldLastMsgSignature = '';
let __worldReplyTarget = null;
let __worldMessagesData = [];

function WriteInWorldDom(data) {
    const dom = document.getElementById('WorldMessageDOM');
    if (!dom) return;
    __worldMessagesData = data;
    if (!data || data.length === 0) {
        const hasMessages = dom.querySelector('.world-msg');
        if (!hasMessages && !dom.querySelector('.world-chat-empty')) {
            dom.innerHTML = '<div class="world-chat-empty">暂无消息，快来抢沙发~</div>';
        }
        __worldLastMsgSignature = '';
        return;
    }
    const sig = data.map(m => m.id + '|' + m.sender_id + '|' + m.content + '|' + (m.parent_id || '') + '|' + (m.created_at || '')).join(';;');
    if (sig === __worldLastMsgSignature) return;
    __worldLastMsgSignature = sig;

    __worldSaveMessages(data);

    const myId = (typeof UserId !== 'undefined') ? UserId : null;
    const isEmpty = dom.querySelector('.world-chat-empty') || !dom.querySelector('.world-msg');
    const oldSigs = new Set();
    dom.querySelectorAll('.world-msg[data-sig]').forEach(el => oldSigs.add(el.dataset.sig));

    const parentMap = {};
    data.forEach(m => { if (m.id) parentMap[m.id] = m; });

    let html = '';
    const needFetch = [];
    for (let i = data.length - 1; i >= 0; i--) {
        const msg = data[i];
        const msgSig = (msg.id || '') + '|' + (msg.sender_id || '') + '|' + (msg.created_at || '') + '|' + (msg.content || '') + '|' + (msg.parent_id || '');
        if (!isEmpty && oldSigs.has(msgSig)) continue;
        const isMe = myId && msg.sender_id === myId;
        const name = msg.sender_name || '匿名';
        let time = '';
        if (msg.created_at) {
            let ts = msg.created_at;
            if (!/[Z+\-]\d{2}:\d{2}$/.test(ts) && !ts.endsWith('Z')) ts += 'Z';
            time = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        const avatar = msg.sender_id && __worldAvatarCache[msg.sender_id] !== undefined ? __worldAvatarCache[msg.sender_id] : null;
        const avatarHtml = avatar
            ? `<img src="${escapeHtml(avatar)}" alt="" class="world-msg-avatar-img">`
            : '<i class="fa fa-user world-msg-avatar-fa"></i>';
        const avatarLink = msg.sender_id && !isMe
            ? `<a href="/users/${escapeHtml(msg.sender_id)}" class="world-msg-avatar-link">${avatarHtml}</a>`
            : avatarHtml;

        let replyHtml = '';
        if (msg.parent_id && parentMap[msg.parent_id]) {
            const pMsg = parentMap[msg.parent_id];
            const pName = pMsg.sender_name || '匿名';
            const pContent = (pMsg.content || '').substring(0, 50);
            replyHtml = `<div class="world-msg-reply" onclick="__scrollToWorldMsg(${pMsg.id})">
                <i class="fa fa-reply"></i>
                <span class="world-reply-name Username">${sanitizeUsernameHtml(pName)}${getUserPrefixBadge(pMsg.sender_id)}</span>
                <span class="world-reply-content">${escapeHtml(pContent)}${pMsg.content.length > 50 ? '...' : ''}</span>
            </div>`;
        }

        html += `<div class="world-msg ${isMe ? 'world-msg-me' : ''}" data-msg-id="${msg.id || ''}" data-sender="${escapeHtml(msg.sender_id || '')}" data-sig="${escapeHtml(msgSig)}">
            <div class="world-msg-avatar">${avatarLink}</div>
            <div class="world-msg-body">
                <div class="world-msg-header">
                    <div class="world-msg-name Username">${sanitizeUsernameHtml(name)}${getUserPrefixBadge(msg.sender_id)}</div>
                    <button class="world-msg-reply-btn" data-msg-id="${msg.id || ''}" title="引用回复"><i class="fa fa-reply"></i></button>
                </div>
                ${replyHtml}
                <div class="world-msg-bubble">${escapeHtml(msg.content || '')}</div>
                <div class="world-msg-time">${time}</div>
            </div>
        </div>`;
        if (msg.sender_id && __worldAvatarCache[msg.sender_id] === undefined && !__worldAvatarLoading[msg.sender_id]) {
            needFetch.push(msg.sender_id);
        }
    }

    if (isEmpty) {
        dom.innerHTML = html;
    } else if (html) {
        dom.insertAdjacentHTML('beforeend', html);
    }
    if (html) dom.scrollTop = dom.scrollHeight;

    needFetch.forEach(sid => {
        __getWorldAvatar(sid, function(avatar) {
            const els = dom.querySelectorAll(`.world-msg[data-sender="${sid}"] .world-msg-avatar`);
            els.forEach(el => {
                const link = el.querySelector('.world-msg-avatar-link');
                if (link) {
                    if (avatar && !link.querySelector('.world-msg-avatar-img')) {
                        link.innerHTML = `<img src="${escapeHtml(avatar)}" alt="" class="world-msg-avatar-img">`;
                    }
                } else if (avatar && !el.querySelector('.world-msg-avatar-img')) {
                    el.innerHTML = `<img src="${escapeHtml(avatar)}" alt="" class="world-msg-avatar-img">`;
                }
            });
        });
    });
}

function SendWorldMessage() {
    const input = document.getElementById('world-chat-input');
    if (!input) return;
    const content = input.value.trim();
    if (!content) return;
    __worldKickActivity();
    const now = Date.now();
    if (now - __worldLastSendTime < __WORLD_SEND_INTERVAL) {
        const remain = Math.ceil((__WORLD_SEND_INTERVAL - (now - __worldLastSendTime)) / 100) / 10;
        const sendBtn = document.getElementById('world-chat-send');
        if (sendBtn) {
            const orig = sendBtn.innerHTML;
            sendBtn.innerHTML = `<i class="fa fa-clock-o"></i> ${remain}s`;
            sendBtn.disabled = true;
            setTimeout(() => {
                if (sendBtn) { sendBtn.innerHTML = orig; sendBtn.disabled = false; }
            }, __WORLD_SEND_INTERVAL - (now - __worldLastSendTime));
        }
        return;
    }
    __worldLastSendTime = now;
    const sendBtn = document.getElementById('world-chat-send');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> 发送中'; }
    apiFetch('/api/World/Send', {
		method: 'POST',
		headers: { 'Accept': 'application/json' },
		body: JSON.stringify({ content: content, parent_id: __worldReplyTarget })
	})
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                input.value = '';
                __clearWorldReply();
            } else {
                alert(data.message || '发送失败');
            }
        })
        .catch(() => { alert('网络错误，发送失败'); })
        .finally(() => {
            if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = '<i class="fa fa-paper-plane"></i> 发送'; }
        });
}

function __setWorldReply(msgId, name) {
    __worldReplyTarget = msgId;
    const input = document.getElementById('world-chat-input');
    if (input) {
        input.placeholder = `回复 ${name}...`;
        input.focus();
    }
    const replyIndicator = document.getElementById('world-reply-indicator');
    if (!replyIndicator) {
        const indicator = document.createElement('div');
        indicator.id = 'world-reply-indicator';
        indicator.className = 'world-reply-indicator';
        indicator.innerHTML = `<span>回复 <b class="Username">${sanitizeUsernameHtml(name)}</b></span><button onclick="__clearWorldReply()"><i class="fa fa-times"></i></button>`;
        input.parentNode.insertBefore(indicator, input);
    } else {
        replyIndicator.innerHTML = `<span>回复 <b class="Username">${sanitizeUsernameHtml(name)}</b></span><button onclick="__clearWorldReply()"><i class="fa fa-times"></i></button>`;
    }
}

function __clearWorldReply() {
    __worldReplyTarget = null;
    const input = document.getElementById('world-chat-input');
    if (input) input.placeholder = '输入消息...';
    const replyIndicator = document.getElementById('world-reply-indicator');
    if (replyIndicator) replyIndicator.remove();
}

function __scrollToWorldMsg(msgId) {
    const dom = document.getElementById('WorldMessageDOM');
    if (!dom) return;
    const el = dom.querySelector(`.world-msg[data-msg-id="${msgId}"]`);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('world-msg-highlight');
        setTimeout(() => el.classList.remove('world-msg-highlight'), 1500);
    }
}







// ==================== 论坛帖子系统 ====================

let __forumCurrentPage = 1;
let __forumCurrentCategory = 'all';
let __forumLoading = false;
let __forumHasMore = true;

const CATEGORY_LABELS = {
    'general': '综合',
    'talk': '闲聊',
    'question': '求助',
    'share': '分享',
    'creative': '创作'
};

const CATEGORY_COLORS = {
    'general': '#6A8C89',
    'talk': '#f59e0b',
    'question': '#ef4444',
    'share': '#10b981',
    'creative': '#8b5cf6'
};

function initForumPage() {
    const list = document.getElementById('forum-post-list');
    if (!list) return;

    __forumCurrentPage = 1;
    __forumCurrentCategory = 'all';
    __forumHasMore = true;

    const tabs = document.querySelectorAll('.forum-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            tabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            __forumCurrentCategory = this.dataset.category;
            __forumCurrentPage = 1;
            __forumHasMore = true;
            list.innerHTML = '<div class="forum-loading">加载中...</div>';
            loadForumPosts();
        });
    });

    loadForumPosts();
}

function loadForumPosts() {
    const list = document.getElementById('forum-post-list');
    if (!list || __forumLoading || !__forumHasMore) return;
    __forumLoading = true;

    const category = __forumCurrentCategory === 'all' ? null : __forumCurrentCategory;
    let url = `/api/posts?page=${__forumCurrentPage}&page_size=20`;
    if (category) url += `&category=${encodeURIComponent(category)}`;

    apiFetch(url)
        .then(res => res.json())
        .then(data => {
            if (!data.success || !data.posts) {
                list.innerHTML = '<div class="forum-empty">加载失败</div>';
                return;
            }
            const posts = data.posts;
            const isFirstPage = __forumCurrentPage === 1;

            if (posts.length === 0 && isFirstPage) {
                list.innerHTML = '<div class="forum-empty">暂无帖子，快来发第一篇吧~</div>';
                __forumHasMore = false;
                return;
            }

            if (posts.length < 20) {
                __forumHasMore = false;
            }

            let html = '';
            posts.forEach(post => {
                html += renderPostCard(post);
            });

            if (isFirstPage) {
                list.innerHTML = html;
            } else {
                list.insertAdjacentHTML('beforeend', html);
            }

            initLazyLoad(list);

            const loadMore = document.getElementById('forum-load-more');
            if (loadMore) {
                loadMore.style.display = __forumHasMore ? 'flex' : 'none';
            }
        })
        .catch(() => {
            if (__forumCurrentPage === 1) {
                list.innerHTML = '<div class="forum-empty">加载失败</div>';
            }
        })
        .finally(() => {
            __forumLoading = false;
        });
}

function loadMorePosts() {
    __forumCurrentPage++;
    loadForumPosts();
}

let __searchCurrentPage = 1;
let __searchKeyword = '';
let __searchLoading = false;
let __searchHasMore = true;
let __searchCurrentTab = 'posts';
let __searchUsers = [];
let __searchPosts = [];

function initSearchPage() {
    const searchInput = document.getElementById('search-page-input');
    const searchBtn = document.getElementById('search-page-btn');
    const resultsArea = document.getElementById('search-page-results');
    if (!searchInput || !searchBtn) return;

    // 从 URL 读取关键词，预填输入框
    const params = new URLSearchParams(window.location.search);
    const initialKw = params.get('k') || '';
    if (initialKw) {
        searchInput.value = initialKw;
    }

    // 执行搜索函数
    function doPageSearch() {
        const kw = searchInput.value.trim();
        if (!kw) {
            searchInput.focus();
            return;
        }
        // 刷新 URL（不刷新页面）
        const newUrl = '/search?k=' + encodeURIComponent(kw);
        if (window.location.search !== '?k=' + encodeURIComponent(kw)) {
            window.history.replaceState(null, '', newUrl);
        }
        // 重置搜索状态
        __searchKeyword = kw;
        __searchCurrentPage = 1;
        __searchHasMore = true;
        __searchPosts = [];
        __searchUsers = [];
        __searchLoading = false;

        const subtitle = document.getElementById('search-subtitle');
        if (subtitle) subtitle.textContent = '关键词：' + kw;

        // 显示结果区域
        if (resultsArea) resultsArea.style.display = '';
        // 切换回帖子 tab
        if (typeof switchSearchTab === 'function') {
            __searchCurrentTab = 'posts';
            const tabs = document.querySelectorAll('.search-tab');
            tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'posts'));
            document.getElementById('search-post-list').style.display = '';
            document.getElementById('search-user-list').style.display = 'none';
        }
        loadSearchResults();
    }

    // 搜索按钮点击
    searchBtn.addEventListener('click', doPageSearch);

    // 回车搜索
    searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            doPageSearch();
        }
    });

    // 初始有关键词时，自动聚焦输入框并触发搜索
    if (initialKw) {
        searchInput.focus();
        doPageSearch();
    }
}

function switchSearchTab(tab) {
    __searchCurrentTab = tab;
    const tabs = document.querySelectorAll('.search-tab');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));

    const postList = document.getElementById('search-post-list');
    const userList = document.getElementById('search-user-list');
    const loadMore = document.getElementById('search-load-more');

    if (tab === 'posts') {
        postList.style.display = '';
        userList.style.display = 'none';
        if (__searchPosts.length === 0 && !__searchLoading) {
            postList.innerHTML = '<div class="forum-empty">没有找到相关帖子</div>';
        }
        loadMore.style.display = __searchPosts.length > 0 && __searchHasMore ? 'flex' : 'none';
    } else {
        postList.style.display = 'none';
        userList.style.display = '';
        renderUserResults(__searchUsers);
        loadMore.style.display = 'none';
    }
}

function loadSearchResults() {
    const postList = document.getElementById('search-post-list');
    if (!postList || __searchLoading || !__searchHasMore) return;
    __searchLoading = true;

    let url = `/api/search?k=${encodeURIComponent(__searchKeyword)}&page=${__searchCurrentPage}&page_size=20`;

    apiFetch(url)
        .then(res => res.json())
        .then(data => {
            if (!data.success) {
                postList.innerHTML = '<div class="forum-empty">搜索失败</div>';
                return;
            }
            const posts = data.posts || [];
            const users = data.users || [];
            const isFirstPage = __searchCurrentPage === 1;

            if (isFirstPage) {
                __searchPosts = posts;
                __searchUsers = users;
            } else {
                __searchPosts = __searchPosts.concat(posts);
                __searchUsers = __searchUsers.concat(users);
            }

            if (posts.length === 0 && isFirstPage) {
                postList.innerHTML = '<div class="forum-empty">没有找到相关帖子</div>';
                __searchHasMore = false;
            } else {
                if (posts.length < 20) {
                    __searchHasMore = false;
                }

                let html = '';
                posts.forEach(post => {
                    html += renderPostCard(post);
                });

                if (isFirstPage) {
                    postList.innerHTML = html;
                } else {
                    postList.insertAdjacentHTML('beforeend', html);
                }
            }

            if (__searchCurrentTab === 'users') {
                renderUserResults(__searchUsers);
            }

            const loadMore = document.getElementById('search-load-more');
            if (loadMore) {
                loadMore.style.display = __searchCurrentTab === 'posts' && __searchHasMore ? 'flex' : 'none';
            }
        })
        .catch(() => {
            if (__searchCurrentPage === 1) {
                postList.innerHTML = '<div class="forum-empty">搜索失败</div>';
            }
        })
        .finally(() => {
            __searchLoading = false;
        });
}

function formatTime(dateStr) {
    if (!dateStr) return '未知';
    try {
        return new Date(dateStr).toLocaleDateString('zh-CN');
    } catch (e) {
        return dateStr;
    }
}

function renderUserResults(users) {
    const userList = document.getElementById('search-user-list');
    if (!userList) return;

    if (users.length === 0) {
        userList.innerHTML = '<div class="forum-empty">没有找到相关用户</div>';
        return;
    }

    let html = '';
    users.forEach(user => {
        const avatar = user.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + user.id;
        const vipIcon = user.vip !== '0' 
            ? '<img src="https://op-kdocs.wpscdn.cn/odimg/web/2024-03-26-12-26/vipnew_hover.svg" class="prefix-badge-svg" style="width:22px;height:22px;">'
            : '<img src="https://op-kdocs.wpscdn.cn/odimg/web/2024-03-26-12-22/vipnormal_gray.svg" class="prefix-badge-svg" style="width:22px;height:22px;">';
        
        let prefixBadge = '';
        if (user.prefix) {
            const p = user.prefix;
            let badgeColor = '';
            if (p.startsWith('HG') && p !== 'HG00000000000000000000') badgeColor = '#3b82f6';
            else if (p.startsWith('HG00000000000000000000')) badgeColor = '#6366f1';
            else if (p === 'YJ') badgeColor = '#f59e0b';
            
            if (badgeColor) {
                prefixBadge = `<div class="prefix-badge" style="background:${badgeColor};"><span>${p}</span></div>`;
            }
        }

        html += `
            <div class="search-user-item" onclick="window.location.href='/users/${user.id}'">
                <div class="search-user-avatar-wrapper">
                    <img src="${avatar}" class="search-user-avatar" loading="lazy">
                    ${vipIcon}
                    ${prefixBadge}
                </div>
                <div class="search-user-info">
                    <div class="search-user-name" style="white-space:nowrap;">${sanitizeUsernameHtml(user.name)}</div>
                    <div class="search-user-time">注册于 ${user.created_at ? formatTime(user.created_at) : '未知'}</div>
                </div>
            </div>
        `;
    });
    userList.innerHTML = html;
}

function loadMoreSearchResults() {
    __searchCurrentPage++;
    loadSearchResults();
}

function renderPostCard(post) {
    const catColor = CATEGORY_COLORS[post.category] || '#6A8C89';
    const catLabel = CATEGORY_LABELS[post.category] || post.category;
    let summary = post.summary || '';
    summary = summary.replace(/<[^>]+>/g, '').substring(0, 100);

    let timeStr = '';
    if (post.created_at) {
        let ts = post.created_at;
        if (!/[Z+\-]\d{2}:\d{2}$/.test(ts) && !ts.endsWith('Z')) ts += 'Z';
        const d = new Date(ts);
        const now = new Date();
        const diff = (now - d) / 1000;
        if (diff < 60) timeStr = '刚刚';
        else if (diff < 3600) timeStr = Math.floor(diff / 60) + '分钟前';
        else if (diff < 86400) timeStr = Math.floor(diff / 3600) + '小时前';
        else if (diff < 2592000) timeStr = Math.floor(diff / 86400) + '天前';
        else timeStr = d.toLocaleDateString();
    }

    return `
<a class="post-card" href="/post/${escapeHtml(post.id)}">
    <div class="post-card-left">
        <div class="post-card-avatar">
            <img src="${escapeHtml(post.user_avatar || '')}" alt="" loading="lazy" />
        </div>
    </div>
    <div class="post-card-body">
        <div class="post-card-header">
            <span class="post-card-category" style="background:${catColor}22;color:${catColor};">${catLabel}</span>
            <span class="post-card-author Username">${sanitizeUsernameHtml(post.user_name || '匿名')}${getUserPrefixBadge(post.user_id)}</span>
            <span class="post-card-time">${timeStr}</span>
        </div>
        <h3 class="post-card-title">${escapeHtml(post.title)}</h3>
        <p class="post-card-summary">${summary}${summary.length >= 100 ? '...' : ''}</p>
        <div class="post-card-footer">
            <span class="post-card-stats">
                <i class="fa fa-eye"></i> ${post.views || 0}
            </span>
            <span class="post-card-stats">
                <i class="fa fa-thumbs-up"></i> ${post.likes || 0}
            </span>
            <span class="post-card-stats">
                <i class="fa fa-comment"></i> 评论
            </span>
        </div>
    </div>
</a>`;
}


// ==================== 帖子详情 ====================

let __currentPostId = null;
let __postLiked = false;
let __postFavorited = false;

function initPostDetailPage() {
    const container = document.getElementById('post-detail-container');
    if (!container) return;

    const path = window.location.pathname;
    const match = path.match(/\/post\/([^/]+)/);
    if (!match) {
        container.innerHTML = '<div class="post-error">帖子不存在</div>';
        return;
    }
    __currentPostId = match[1];
    __postLiked = false;
    __postFavorited = false;

    apiFetch(`/api/posts/${__currentPostId}`)
        .then(res => res.json())
        .then(data => {
            if (!data.success) {
                container.innerHTML = '<div class="post-error">帖子不存在</div>';
                return;
            }
            __postLiked = !!data.liked;
            __postFavorited = !!data.favorited;
            renderPostDetail(data.post, data.comments);
        })
        .catch(() => {
            container.innerHTML = '<div class="post-error">加载失败</div>';
        });
}

let __commentReplyTarget = null;

function _renderContent(content) {
    if (!content) return '';
    let html;
    try {
        if (typeof marked !== 'undefined' && marked.parse) {
            html = marked.parse(content, { breaks: true, gfm: true });
        } else {
            html = content;
        }
    } catch(e) {
        html = content;
    }
    return _sanitizeHtml(html);
}

/* 清理 Markdown 渲染后的 HTML，移除危险标签/属性以防范 XSS。
   允许保留常见格式标签，拦截 script/iframe/onclick 等。
   同时将外部链接改写为 /GoTo?to=<encoded> 过渡页跳转。 */
function _sanitizeHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    // 移除危险标签
    const dangerTags = ['script', 'iframe', 'object', 'embed', 'form', 'style', 'link', 'meta'];
    dangerTags.forEach(function(tag) {
        const els = div.querySelectorAll(tag);
        els.forEach(function(el) { el.remove(); });
    });
    // 移除所有 on* 事件属性与 javascript: 协议
    const all = div.querySelectorAll('*');
    all.forEach(function(el) {
        Array.prototype.slice.call(el.attributes).forEach(function(attr) {
            const name = attr.name.toLowerCase();
            const val = attr.value.trim().toLowerCase();
            if (name.startsWith('on')) {
                el.removeAttribute(attr.name);
            } else if ((name === 'href' || name === 'src') && val.startsWith('javascript:')) {
                el.removeAttribute(attr.name);
            }
        });
    });
    // 外部链接改写为 /GoTo 过渡页（根域名 yjlt.top 直接放行）
    const links = div.querySelectorAll('a[href]');
    links.forEach(function(a) {
        const href = a.getAttribute('href') || '';
        if (_isExternalLink(href)) {
            a.setAttribute('href', '/GoTo?to=' + encodeURIComponent(href));
            a.setAttribute('rel', 'nofollow noopener noreferrer');
            if (!a.getAttribute('target')) a.setAttribute('target', '_blank');
        }
    });
    return div.innerHTML;
}

/* 判断链接是否为外部链接（非 yjlt.top 根域名）。
   - 协议为 http/https 时按 hostname 判断
   - 其他协议（mailto:、tel:、javascript: 已被清理等）视为外部需改写 */
function _isExternalLink(href) {
    if (!href) return false;
    // 相对路径（/xxx、./xxx、#anchor）直接放行
    if (href.charAt(0) === '/' || href.charAt(0) === '#' || href.charAt(0) === '?') return false;
    const m = /^([a-zA-Z][a-zA-Z0-9+.\-]*):\/\/([^\/?#]+)/.exec(href);
    if (!m) return false;
    const host = m[2].toLowerCase();
    if (host === 'yjlt.top' || host.endsWith('.yjlt.top')) return false;
    return true;
}

function renderPostDetail(post, comments) {
    const container = document.getElementById('post-detail-container');
    if (!container) return;

    __commentReplyTarget = null;

    const catColor = CATEGORY_COLORS[post.category] || '#6A8C89';
    const catLabel = CATEGORY_LABELS[post.category] || post.category;

    let timeStr = '';
    if (post.created_at) {
        let ts = post.created_at;
        if (!/[Z+\-]\d{2}:\d{2}$/.test(ts) && !ts.endsWith('Z')) ts += 'Z';
        const d = new Date(ts);
        timeStr = d.toLocaleString();
    }

    const parentMap = {};
    const replyMap = {};
    if (comments && comments.length > 0) {
        comments.forEach(c => {
            parentMap[c.id] = c;
        });
        // 将所有回复（含多级回复：子评论→孙评论…）全部归并到所属"根评论"下，
        // 避免 parent_id 不指向根评论的回复在刷新后被遗漏
        comments.forEach(c => {
            if (!c.parent_id) return;
            let rootId = c.parent_id;
            let visited = 0;
            while (parentMap[rootId] && parentMap[rootId].parent_id && visited < 50) {
                rootId = parentMap[rootId].parent_id;
                visited++;
            }
            if (!replyMap[rootId]) replyMap[rootId] = [];
            replyMap[rootId].push(c);
        });
        // 回复按 created_at 升序排列（折叠区为历史回复，可视区为最新2条）
        Object.keys(replyMap).forEach(rootId => {
            replyMap[rootId].sort((a, b) => {
                const ta = a.created_at ? new Date(String(a.created_at).endsWith('Z') || /[+\-]\d{2}:\d{2}$/.test(String(a.created_at)) ? a.created_at : a.created_at + 'Z').getTime() : 0;
                const tb = b.created_at ? new Date(String(b.created_at).endsWith('Z') || /[+\-]\d{2}:\d{2}$/.test(String(b.created_at)) ? b.created_at : b.created_at + 'Z').getTime() : 0;
                return ta - tb;
            });
        });
    }

    let commentsHtml = '';
    if (comments && comments.length > 0) {
        const mainComments = comments.filter(c => !c.parent_id).reverse();
        mainComments.forEach(c => {
            commentsHtml += renderComment(c, parentMap);
            const replies = replyMap[c.id];
            if (replies && replies.length > 0) {
                const total = replies.length;
                const visibleCount = Math.min(total, 2);
                const visibleReplies = replies.slice(total - visibleCount, total);
                const hiddenReplies = replies.slice(0, total - visibleCount);
                let repliesHtml = '<div class="comment-replies">';
                visibleReplies.forEach(r => {
                    repliesHtml += renderComment(r, parentMap, true);
                });
                if (hiddenReplies.length > 0) {
                    repliesHtml += `<button class="comment-replies-toggle" data-parent-id="${c.id}" onclick="__toggleCommentReplies('${c.id}')">
                        <i class="fa fa-chevron-down"></i> 展开${hiddenReplies.length}条回复
                    </button>`;
                    repliesHtml += `<div class="comment-replies-hidden" data-parent-id="${c.id}" style="display: none;">`;
                    hiddenReplies.forEach(r => {
                        repliesHtml += renderComment(r, parentMap, true);
                    });
                    repliesHtml += '</div>';
                }
                repliesHtml += '</div>';
                commentsHtml += repliesHtml;
            }
        });
    } else {
        commentsHtml = '<div class="comment-empty">暂无评论，快来抢沙发~</div>';
    }

    const deleteBtnHtml = UserId && post.user_id === UserId ?
        `<button class="post-action-btn post-delete-btn" onclick="deletePost('${post.id}')"><i class="fa fa-trash-o"></i><span class="post-action-label">删除</span></button>` : '';

    const reportBtnHtml = (!UserId || post.user_id !== UserId) ?
        `<button class="post-action-btn" onclick="showReportDialog('${post.id}')"><i class="fa fa-flag"></i><span class="post-action-label">举报</span></button>` : '';

    container.innerHTML = `
<div class="post-detail">
    <div class="post-detail-header">
        <a href="javascript:history.back()" class="post-back-btn">
            <i class="fa fa-arrow-left"></i> 返回
        </a>
    </div>

    <article class="post-content">
        <div class="post-meta-top">
            <span class="post-category-badge" style="background:${catColor}22;color:${catColor};">${catLabel}</span>
        </div>
        <h1 class="post-title">${escapeHtml(post.title)}</h1>

        <div class="post-author-row">
            <a href="/users/${escapeHtml(post.user_id)}" class="post-author-avatar">
                <img src="${escapeHtml(post.user_avatar || '')}" alt="" loading="lazy" />
            </a>
            <div class="post-author-info">
                <a href="/users/${escapeHtml(post.user_id)}" class="post-author-name Username">${sanitizeUsernameHtml(post.user_name || '匿名')}${getUserPrefixBadge(post.user_id)}</a>
                <div class="post-author-meta">
                    <span>${timeStr}</span>
                    <span>·</span>
                    <span><i class="fa fa-eye"></i> ${post.views || 0}</span>
                </div>
            </div>
        </div>

        <div class="post-body-html">
            ${_renderContent(post.content || '')}
        </div>

        <div class="post-actions">
            <button class="post-action-btn ${__postLiked ? 'liked' : ''}" id="post-like-btn" onclick="togglePostLike()">
                <i class="fa fa-thumbs-up"></i>
                <span id="post-like-count">${post.likes || 0}</span>
            </button>
            <button class="post-action-btn ${__postFavorited ? 'favorited' : ''}" id="post-favorite-btn" onclick="togglePostFavorite()">
                <i class="fa fa-bookmark"></i>
                <span class="post-action-label">收藏</span>
            </button>
            <button class="post-action-btn" onclick="document.getElementById('comment-input').focus()">
                <i class="fa fa-comment"></i>
                <span>${comments ? comments.filter(c => !c.parent_id).length : 0}</span>
            </button>
            <button class="post-action-btn" onclick="sharePost()">
                <i class="fa fa-share-alt"></i>
                <span class="post-action-label">分享</span>
            </button>
            ${reportBtnHtml}
            ${deleteBtnHtml}
        </div>
    </article>

    <div class="comment-section">
        <div class="comment-section-title">评论区</div>
        <div class="comment-input-bar">
            <input type="text" id="comment-input" placeholder="写下你的评论..." maxlength="500" />
            <button class="comment-send-btn" onclick="submitComment()">发送</button>
        </div>
        <div class="comment-list" id="comment-list">
            ${commentsHtml}
        </div>
    </div>
</div>`;

    initLazyLoad(container);

    const commentInput = document.getElementById('comment-input');
    if (commentInput) {
        commentInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitComment();
            }
        });
    }

    const commentList = document.getElementById('comment-list');
    if (commentList) {
        commentList.addEventListener('click', function(e) {
            const replyBtn = e.target.closest('.comment-reply-btn');
            if (replyBtn) {
                const commentId = replyBtn.dataset.commentId;
                const userName = replyBtn.dataset.userName;
                __setCommentReply(commentId, userName);
            }
        });
    }
}

function __setCommentReply(commentId, userName) {
    __commentReplyTarget = commentId;
    const input = document.getElementById('comment-input');
    if (input) {
        input.placeholder = `回复 ${userName}...`;
        input.focus();
    }
    const indicator = document.getElementById('comment-reply-indicator');
    if (!indicator) {
        const ind = document.createElement('div');
        ind.id = 'comment-reply-indicator';
        ind.className = 'comment-reply-indicator';
        ind.innerHTML = `<span>回复 <b class="Username">${sanitizeUsernameHtml(userName)}</b></span><button onclick="__clearCommentReply()"><i class="fa fa-times"></i></button>`;
        input.parentNode.insertBefore(ind, input);
    } else {
        indicator.innerHTML = `<span>回复 <b class="Username">${sanitizeUsernameHtml(userName)}</b></span><button onclick="__clearCommentReply()"><i class="fa fa-times"></i></button>`;
    }
}

function __clearCommentReply() {
    __commentReplyTarget = null;
    const input = document.getElementById('comment-input');
    if (input) input.placeholder = '写下你的评论...';
    const indicator = document.getElementById('comment-reply-indicator');
    if (indicator) indicator.remove();
}

function __toggleCommentReplies(parentId) {
    const hiddenEl = document.querySelector(`.comment-replies-hidden[data-parent-id="${parentId}"]`);
    const toggleBtn = document.querySelector(`.comment-replies-toggle[data-parent-id="${parentId}"]`);
    if (hiddenEl && toggleBtn) {
        if (hiddenEl.style.display === 'none' || !hiddenEl.style.display) {
            hiddenEl.style.display = 'block';
            toggleBtn.innerHTML = '<i class="fa fa-chevron-up"></i> 收起回复';
        } else {
            hiddenEl.style.display = 'none';
            const count = hiddenEl.querySelectorAll('.comment-item-reply').length;
            toggleBtn.innerHTML = `<i class="fa fa-chevron-down"></i> 展开${count}条回复`;
        }
    }
}

function togglePostLike() {
    if (!__currentPostId) return;
    const btn = document.getElementById('post-like-btn');
    if (!btn || !UserId) {
        window.location.href = '/login';
        return;
    }

    apiFetch(`/api/posts/${__currentPostId}/like`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                __postLiked = data.liked;
                if (data.liked) {
                    btn.classList.add('liked');
                } else {
                    btn.classList.remove('liked');
                }
                const count = document.getElementById('post-like-count');
                if (count) count.textContent = data.likes || 0;
            }
        })
        .catch(() => {});
}

function togglePostFavorite() {
    if (!__currentPostId) return;
    const btn = document.getElementById('post-favorite-btn');
    if (!btn || !UserId) {
        window.location.href = '/login';
        return;
    }

    apiFetch(`/api/posts/${__currentPostId}/favorite`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                __postFavorited = data.favorited;
                if (data.favorited) {
                    btn.classList.add('favorited');
                } else {
                    btn.classList.remove('favorited');
                }
            }
        })
        .catch(() => {});
}

function showReportDialog(postId) {
    if (!postId || !UserId) {
        window.location.href = '/login';
        return;
    }
    const reasons = [
        { value: 'spam', label: '垃圾广告' },
        { value: 'abuse', label: '辱骂攻击' },
        { value: 'porn', label: '色情低俗' },
        { value: 'illegal', label: '违法违规' },
        { value: 'infringement', label: '侵权抄袭' },
        { value: 'other', label: '其他' }
    ];
    let reasonHtml = reasons.map(r =>
        `<label class="report-reason-item"><input type="radio" name="report-reason" value="${r.value}"> ${r.label}</label>`
    ).join('');
    UpdataWindowsCardWithCenterSreen(`
        <h3><i class="fa fa-flag"></i> 举报帖子</h3>
        <div class="report-reason-list">${reasonHtml}</div>
        <textarea class="report-detail-input" id="report-detail" placeholder="补充说明（可选，最多500字）" maxlength="500"></textarea>
        <div class="report-actions">
            <button class="report-cancel" onclick="ShowOrhidenWindowsCardWithCenterSreen(0)">取消</button>
            <button class="report-submit" onclick="submitReport('${postId}')">提交举报</button>
        </div>
    `);
}

function submitReport(postId) {
    const selected = document.querySelector('input[name="report-reason"]:checked');
    if (!selected) {
        alert('请选择举报原因');
        return;
    }
    const detailEl = document.getElementById('report-detail');
    const detail = detailEl ? detailEl.value.trim() : '';
    apiFetch(`/api/posts/${postId}/report`, {
        method: 'POST',
        body: JSON.stringify({ reason: selected.value, detail: detail })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert('举报已提交，感谢您的反馈');
            ShowOrhidenWindowsCardWithCenterSreen();
        } else {
            alert(data.message || '举报失败');
        }
    })
    .catch(() => alert('网络错误'));
}

function sharePost() {
    if (navigator.share) {
        navigator.share({
            title: document.title,
            url: window.location.href
        });
    } else {
        navigator.clipboard && navigator.clipboard.writeText(window.location.href);
        alert('链接已复制到剪贴板');
    }
}

function toggleFollowUser(userId) {
    if (!userId) return;
    // 不再用前端的 UserId 预判登录态：session 才是真相。
    // 直接发 API，后端说要登录再跳，避免"前端判断未登录但实际已登录"的误跳转
    const btn = document.getElementById('user-follow-btn');
    if (btn) {
        try {
            btn.setAttribute('disabled', 'disabled');
            btn.style.opacity = '0.6';
            btn.style.pointerEvents = 'none';
        } catch(_) {}
    }
    apiFetch(`/api/users/${userId}/follow`, { method: 'POST' })
        .then(res => {
            const needLogin = res.status === 401;
            return res.json().then(data => {
                data.__needLogin = needLogin || (data.message && /登录/.test(data.message));
                return data;
            });
        })
        .then(data => {
            if (data.success) {
                if (btn) {
                    if (data.following) {
                        btn.classList.add('following');
                        btn.innerHTML = '<i class="fa fa-check"></i> 已关注';
                    } else {
                        btn.classList.remove('following');
                        btn.innerHTML = '<i class="fa fa-plus"></i> 关注';
                    }
                }
                const followerEl = document.getElementById('user-follower-count');
                if (followerEl) {
                    let count = parseInt(followerEl.innerText, 10) || 0;
                    followerEl.innerText = data.following ? count + 1 : Math.max(count - 1, 0);
                }
            } else if (data.__needLogin) {
                // 真的需要登录：把前端本地所有"我以为我登录了"的缓存都清掉
                UserId = undefined;
                try { sessionStorage.removeItem('userInfo'); } catch (_) {}
                try { document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax;'; } catch(_) {}
                window.location.href = '/login';
                return;
            } else {
                alert(data.message || '操作失败');
            }
        })
        .catch(() => alert('网络错误'))
        .finally(() => {
            if (btn) {
                try {
                    btn.removeAttribute('disabled');
                    btn.style.opacity = '';
                    btn.style.pointerEvents = '';
                } catch(_) {}
            }
        });
}

function deletePost(postId) {
    if (!postId || !UserId) return;
    if (!confirm('确定要删除这篇帖子吗？删除后无法恢复。')) return;
    apiFetch(`/api/posts/${postId}/delete`, {
        method: 'POST'
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert('帖子已删除');
                window.location.href = '/forum';
            } else {
                alert(data.message || '删除失败');
            }
        })
        .catch(() => { alert('网络错误'); });
}

function deleteComment(commentId) {
    if (!commentId || !UserId) return;
    if (!confirm('确定要删除这条评论吗？')) return;
    apiFetch(`/api/comments/${commentId}/delete`, {
        method: 'POST'
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const el = document.querySelector(`.comment-item[data-comment-id="${commentId}"]`);
                if (el) {
                    el.style.opacity = '0';
                    setTimeout(() => el.remove(), 300);
                }
            } else {
                alert(data.message || '删除失败');
            }
        })
        .catch(() => { alert('网络错误'); });
}

function renderComment(c, parentMap, isReply = false) {
    let timeStr = '';
    if (c.created_at) {
        let ts = c.created_at;
        if (!/[Z+\-]\d{2}:\d{2}$/.test(ts) && !ts.endsWith('Z')) ts += 'Z';
        const d = new Date(ts);
        const now = new Date();
        const diff = (now - d) / 1000;
        if (diff < 60) timeStr = '刚刚';
        else if (diff < 3600) timeStr = Math.floor(diff / 60) + '分钟前';
        else if (diff < 86400) timeStr = Math.floor(diff / 3600) + '小时前';
        else timeStr = d.toLocaleDateString();
    }

    let replyHtml = '';
    if (c.parent_id && parentMap && parentMap[c.parent_id]) {
        const parent = parentMap[c.parent_id];
        replyHtml = `<div class="comment-reply-to">回复 <a href="/users/${escapeHtml(parent.user_id)}" class="Username">${sanitizeUsernameHtml(parent.user_name || '匿名')}${getUserPrefixBadge(parent.user_id)}</a></div>`;
    }

    const replyBtn = `<button class="comment-reply-btn" data-comment-id="${c.id || ''}" data-user-name="${escapeHtml(c.user_name || '匿名')}"><i class="fa fa-reply"></i> 回复</button>`;
    const deleteBtn = (typeof UserId !== 'undefined' && UserId && c.user_id === UserId) ? `<button class="comment-delete-btn" onclick="deleteComment('${c.id || ''}')" title="删除"><i class="fa fa-trash-o"></i></button>` : '';

    return `
<div class="comment-item ${isReply ? 'comment-item-reply' : ''}" data-comment-id="${c.id || ''}">
    <a href="/users/${escapeHtml(c.user_id)}" class="comment-avatar">
        <img src="${escapeHtml(c.user_avatar || '')}" alt="" loading="lazy" />
    </a>
    <div class="comment-body">
        <div class="comment-header">
            <a href="/users/${escapeHtml(c.user_id)}" class="comment-author Username">${sanitizeUsernameHtml(c.user_name || '匿名')}${getUserPrefixBadge(c.user_id)}</a>
            <span class="comment-time">${timeStr}</span>
        </div>
        ${replyHtml}
        <div class="comment-text">${_renderContent(c.content || '')}</div>
        <div class="comment-footer">
            <span class="comment-like">
                <i class="fa fa-thumbs-o-up"></i> ${c.likes || 0}
            </span>
            ${replyBtn}
            ${deleteBtn}
        </div>
    </div>
</div>`;
}

function submitComment() {
    if (!__currentPostId) return;
    if (!UserId) {
        window.location.href = '/login';
        return;
    }
    const input = document.getElementById('comment-input');
    if (!input) return;
    const content = input.value.trim();
    if (!content) return;

    const sendBtn = document.querySelector('.comment-send-btn');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '发送中'; }

    const parentId = __commentReplyTarget;
    apiFetch(`/api/posts/${__currentPostId}/comments/create`, {
        method: 'POST',
        body: JSON.stringify({ content: content, parent_id: parentId })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success && data.comment) {
                input.value = '';
                __clearCommentReply();
                const list = document.getElementById('comment-list');
                if (list) {
                    const empty = list.querySelector('.comment-empty');
                    if (empty) empty.remove();
                    if (parentId) {
                        const parentItem = list.querySelector(`[data-comment-id="${parentId}"]`);
                        if (parentItem) {
                            const repliesContainer = parentItem.querySelector('.comment-replies');
                            if (repliesContainer) {
                                const toggleBtn = repliesContainer.querySelector('.comment-replies-toggle');
                                if (toggleBtn) {
                                    toggleBtn.insertAdjacentHTML('beforebegin', renderComment(data.comment, {}, true));
                                } else {
                                    repliesContainer.insertAdjacentHTML('beforeend', renderComment(data.comment, {}, true));
                                }
                            } else {
                                const replies = document.createElement('div');
                                replies.className = 'comment-replies';
                                replies.innerHTML = renderComment(data.comment, {}, true);
                                parentItem.insertAdjacentElement('afterend', replies);
                            }
                        }
                    } else {
                        list.insertAdjacentHTML('beforeend', renderComment(data.comment, {}));
                    }
                    list.scrollTop = list.scrollHeight;
                }
            } else {
                alert(data.message || '评论失败');
            }
        })
        .catch(() => { alert('网络错误'); })
        .finally(() => {
            if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '发送'; }
        });
}


// ==================== 发布帖子 ====================

let __selectedCategory = 'general';

function initPostCreatePage() {
    const editor = document.getElementById('post-content-editor');
    if (!editor) return;

    const chips = document.querySelectorAll('#form-category-select .category-chip');
    chips.forEach(chip => {
        chip.addEventListener('click', function() {
            chips.forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            __selectedCategory = this.dataset.value;
        });
    });
}

function switchPostEditorTab(tab) {
    const editTab = document.getElementById('tab-edit');
    const previewTab = document.getElementById('tab-preview');
    const editor = document.getElementById('post-content-editor');
    const preview = document.getElementById('post-content-preview');

    if (!editTab || !previewTab || !editor || !preview) return;

    if (tab === 'edit') {
        editTab.classList.add('active');
        previewTab.classList.remove('active');
        preview.style.display = 'none';
        editor.style.display = '';
    } else if (tab === 'preview') {
        editTab.classList.remove('active');
        previewTab.classList.add('active');
        editor.style.display = 'none';
        preview.style.display = '';

        const content = editor.value.trim();
        if (!content) {
            preview.innerHTML = '<div style="color:var(--color-text-tertiary);text-align:center;padding:40px;">暂无内容</div>';
        } else {
            preview.innerHTML = _renderContent(content);
        }
    }
}

function submitPost() {
    if (!UserId) {
        window.location.href = '/login';
        return;
    }
    const titleInput = document.getElementById('post-title-input');
    const editor = document.getElementById('post-content-editor');
    if (!titleInput || !editor) return;

    const title = titleInput.value.trim();
    const content = editor.value.trim();

    if (!title) { alert('请输入标题'); return; }
    if (title.length > 100) { alert('标题过长（最多100字）'); return; }
    if (!content) { alert('请输入内容'); return; }

    const btn = document.getElementById('post-submit-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> 发布中'; }

    apiFetch('/api/posts/create', {
        method: 'POST',
        body: JSON.stringify({
            title: title,
            content: content,
            category: __selectedCategory
        })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                alert('发布成功');
                window.location.href = `/post/${data.id}`;
            } else {
                alert(data.message || '发布失败');
            }
        })
        .catch(() => { alert('网络错误，发布失败'); })
        .finally(() => {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa fa-paper-plane"></i> 发布'; }
        });
}


// ==================== Action 扩展 ====================

function initHomePage() {
    const list = document.getElementById('home-post-list');
    if (!list) return;
    loadHomePosts();
    loadHomeFavorites();
}

function loadHomeFavorites() {
    const section = document.getElementById('home-favorites');
    const list = document.getElementById('home-favorites-list');
    if (!section || !list) return;
    if (!UserId) {
        section.style.display = 'none';
        return;
    }
    apiFetch(`/api/users/${UserId}/favorites?page=1&page_size=10`)
        .then(res => res.json())
        .then(data => {
            if (!data.success || !data.posts || data.posts.length === 0) {
                section.style.display = 'none';
                return;
            }
            section.style.display = '';
            let html = '';
            data.posts.forEach(post => {
                html += renderPostCard(post);
            });
            list.innerHTML = html;
        })
        .catch(() => {
            section.style.display = 'none';
        });
}

let __homePostsCache = null;

function loadHomePosts(forceRefresh) {
    const list = document.getElementById('home-post-list');
    if (!list) return;

    if (!forceRefresh && __homePostsCache) {
        let html = '';
        __homePostsCache.forEach(post => {
            html += renderPostCard(post);
        });
        list.innerHTML = html;
        return;
    }

    const btn = document.getElementById('home-refresh-btn');
    if (btn) {
        btn.disabled = true;
        const icon = btn.querySelector('.fa-refresh');
        if (icon) icon.classList.add('fa-spin');
    }

    apiFetch('/api/posts/random')
        .then(res => res.json())
        .then(data => {
            if (!data.success || !data.posts) {
                list.innerHTML = '<div class="forum-empty">加载失败</div>';
                return;
            }
            const posts = data.posts;
            if (posts.length === 0) {
                list.innerHTML = '<div class="forum-empty">还没有帖子，快来发第一篇吧~</div>';
                return;
            }

            __homePostsCache = posts;
            let html = '';
            posts.forEach(post => {
                html += renderPostCard(post);
            });
            list.innerHTML = html;
        })
        .catch(() => {
            list.innerHTML = '<div class="forum-empty">加载失败</div>';
        })
        .finally(() => {
            if (btn) {
                btn.disabled = false;
                const icon = btn.querySelector('.fa-refresh');
                if (icon) icon.classList.remove('fa-spin');
            }
        });
}

let __homeRefreshLocked = false;
function refreshHomePosts() {
    if (__homeRefreshLocked) return;
    __homeRefreshLocked = true;
    const btn = document.getElementById('home-refresh-btn');
    if (btn) btn.disabled = true;
    try {
        __homePostsCache = null;
        loadHomePosts(true);
    } finally {
        setTimeout(() => {
            __homeRefreshLocked = false;
            if (btn) btn.disabled = false;
        }, 5000);
    }
}

function initForumPages() {
    initHomePage();
    initForumPage();
    initPostDetailPage();
    initPostCreatePage();
    initSearchPage();
}



loadUserInfo().then(() => {
    loadGetHtml().then(() => {
        initAuthPage();
        initMouseLinuxPage();
        initUserProfilePage();
        initForumPages();
        initLive2DPage();
        Action()
    });
});

let __live2dInstance = null;

function updateLive2DProgress(text, percent) {
    try {
        const fillEl = document.getElementById('live2d-progress-fill');
        const textEl = document.getElementById('live2d-progress-text');
        const percentEl = document.getElementById('live2d-progress-percent');
        if (fillEl) fillEl.style.width = percent + '%';
        if (textEl) textEl.textContent = text;
        if (percentEl) percentEl.textContent = percent + '%';
    } catch (e) { /* 进度更新不影响主流程，不应该触发 error 显示 */ }
}

function hideLive2DStatus() {
    try {
        const loadingEl = document.getElementById('live2d-loading');
        const errorEl = document.getElementById('live2d-error');
        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl) errorEl.style.display = 'none';
    } catch (e) {}
}

function initLive2DPage() {
    const wrapper = document.getElementById('live2d-canvas-wrapper');
    if (!wrapper) return;

    const lpkUrl = 'https://assets.crazying-dev.top/text/one/Live2D/HEI.lpk';

    function loadLive2DLPK() {
        return new Promise((resolve, reject) => {
            if (typeof Live2DLPK !== 'undefined') {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = 'https://assets.crazying-dev.top/text/one/JS/Live2DLPK.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    function loadLive2DModel() {
        // 进入加载流程前先把旧的失败提示清空，避免重进页面时残留
        hideLive2DStatus();
        updateLive2DProgress('加载依赖库...', 0);
        loadLive2DLPK().then(() => {
            Live2DLPK.load(lpkUrl, wrapper, {
                onProgress: updateLive2DProgress
            }).then(instance => {
                __live2dInstance = instance;
                // 加载成功 → 立即隐藏"加载失败"提示（不要等 300ms 后）
                const errorEl = document.getElementById('live2d-error');
                if (errorEl) errorEl.style.display = 'none';
                setTimeout(() => {
                    // 进度层延迟 300ms 隐藏（给用户看清 100%）；
                    // 同时再清一次失败提示，防止竞态
                    hideLive2DStatus();
                }, 300);
            }).catch(err => {
                console.error('Live2D load error:', err);
                showLive2DError();
            });
        }).catch(err => {
            console.error('Live2D bootstrap error:', err);
            showLive2DError();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadLive2DModel);
    } else {
        loadLive2DModel();
    }
}

function showLive2DError() {
    try {
        const loadingEl = document.getElementById('live2d-loading');
        const errorEl = document.getElementById('live2d-error');
        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl) errorEl.style.display = 'flex';
    } catch (e) {}
}
