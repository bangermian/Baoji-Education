/* ===========================================================
   豹鸡教育 · 全站公共脚本
   1) 注入公共样式
   2) 图片加载失败兜底
   3) 右下角「小鱼」陪聊悬浮球
   -----------------------------------------------------------
   后端接口：POST /api/chat   { messages: [{role, content}] }
            返回：{ reply: "..." }  或  { error: "..." }
   =========================================================== */
(function () {
    'use strict';

    /* ---------------- 基础配置 ---------------- */
    var CONFIG = {
        name: '小鱼',                       // 悬浮球与面板标题
        subtitle: '豹鸡教育 · 陪聊',
        endpoint: '/api/chat',              // Worker 路由
        greeting: '我是小鱼 🐟 豹鸡教育的陪聊客服，随便聊点啥都行～',
        historyKey: 'xy_chat_v1',
        maxHistory: 20,                     // 本地保存条数
        maxContext: 10,                     // 每次请求带上的上下文条数
        offlineTip: '小鱼暂时掉线了（后台还没接好），稍后再试试？'
    };

    /* ---------------- 定位自身并注入样式 ---------------- */
    var selfScript = document.currentScript ||
        document.querySelector('script[src*="assets/app.js"]');
    var baseDir = selfScript
        ? new URL('.', selfScript.src)
        : new URL('/', location.href);

    if (!document.getElementById('xy-style')) {
        var link = document.createElement('link');
        link.id = 'xy-style';
        link.rel = 'stylesheet';
        link.href = new URL('app.css', baseDir).href;
        document.head.appendChild(link);
    }

    /* ---------------- 图片兜底 ---------------- */
    function watchImages() {
        var images = document.querySelectorAll('img');
        Array.prototype.forEach.call(images, function (img) {
            if (img.dataset.xyWatched) return;
            img.dataset.xyWatched = '1';

            var showPlaceholder = function () {
                if (!img.parentNode) return;
                var holder = document.createElement('div');
                holder.className = (img.className ? img.className + ' ' : '') + 'img-fallback';
                holder.textContent = img.alt || '图片暂缺';
                if (img.id) holder.id = img.id;
                img.parentNode.replaceChild(holder, img);
            };

            if (img.complete && img.naturalWidth === 0) showPlaceholder();
            else img.addEventListener('error', showPlaceholder);
        });
    }

    /* ---------------- 聊天状态 ---------------- */
    var history = [];
    var sending = false;

    function loadHistory() {
        try {
            var raw = localStorage.getItem(CONFIG.historyKey);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) history = parsed;
            }
        } catch (e) { /* 忽略：隐私模式下 localStorage 不可用 */ }
    }

    function saveHistory() {
        try {
            localStorage.setItem(CONFIG.historyKey,
                JSON.stringify(history.slice(-CONFIG.maxHistory)));
        } catch (e) { /* 忽略 */ }
    }

    /* ---------------- 构建界面 ---------------- */
    function buildWidget() {
        if (document.getElementById('xy-fab')) return;

        var iconURL = new URL('xiaoyu.svg', baseDir).href;
        var offlineURL = new URL('xiaoyu-offline.svg', baseDir).href;

        var fab = document.createElement('button');
        fab.id = 'xy-fab';
        fab.type = 'button';
        fab.setAttribute('aria-label', '打开' + CONFIG.name + '聊天窗口');
        fab.innerHTML = '<img class="xy-ico" src="' + iconURL + '" alt="">' +
            '<span>' + CONFIG.name + '</span>';

        var panel = document.createElement('section');
        panel.id = 'xy-panel';
        panel.setAttribute('aria-live', 'polite');
        panel.innerHTML =
            '<div id="xy-head">' +
                '<div id="xy-avatar"><img src="' + iconURL + '" alt=""></div>' +
                '<div id="xy-head-info"><strong>' + CONFIG.name + '</strong>' +
                '<small>' + CONFIG.subtitle + '</small></div>' +
                '<button id="xy-close" type="button" aria-label="关闭">×</button>' +
            '</div>' +
            '<div id="xy-msgs"></div>' +
            '<form id="xy-form">' +
                '<input id="xy-input" type="text" autocomplete="off" ' +
                    'placeholder="和小鱼说点什么…" maxlength="500">' +
                '<button id="xy-send" type="submit">发送</button>' +
            '</form>';

        document.body.appendChild(fab);
        document.body.appendChild(panel);

        var msgs = panel.querySelector('#xy-msgs');
        var input = panel.querySelector('#xy-input');
        var sendBtn = panel.querySelector('#xy-send');
        var form = panel.querySelector('#xy-form');

        function scrollDown() {
            msgs.scrollTop = msgs.scrollHeight;
        }

        function addBubble(role, text, icon) {
            var div = document.createElement('div');
            div.className = 'xy-msg ' +
                (role === 'user' ? 'xy-me' : role === 'assistant' ? 'xy-bot' : 'xy-sys');
            if (icon) {
                var img = document.createElement('img');
                img.className = 'xy-sys-ico';
                img.src = icon;
                img.alt = '';
                div.appendChild(img);
            }
            div.appendChild(document.createTextNode(text));   // 一律文本节点，避免注入
            msgs.appendChild(div);
            scrollDown();
            return div;
        }

        function addTyping() {
            var div = document.createElement('div');
            div.className = 'xy-msg xy-bot';
            div.innerHTML = '<span class="xy-typing"><i></i><i></i><i></i></span>';
            msgs.appendChild(div);
            scrollDown();
            return div;
        }

        function renderHistory() {
            msgs.innerHTML = '';
            if (!history.length) {
                addBubble('assistant', CONFIG.greeting);
                return;
            }
            history.forEach(function (m) {
                addBubble(m.role, m.content);
            });
        }

        function openPanel() {
            panel.classList.add('xy-open');
            renderHistory();
            setTimeout(function () { input.focus(); }, 60);
        }

        function closePanel() {
            panel.classList.remove('xy-open');
        }

        fab.addEventListener('click', function () {
            if (panel.classList.contains('xy-open')) closePanel();
            else openPanel();
        });
        panel.querySelector('#xy-close').addEventListener('click', closePanel);
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') closePanel();
        });

        form.addEventListener('submit', function (ev) {
            ev.preventDefault();
            var text = input.value.trim();
            if (!text || sending) return;

            sending = true;
            sendBtn.disabled = true;
            input.value = '';
            history.push({ role: 'user', content: text });
            addBubble('user', text);
            saveHistory();

            var typing = addTyping();

            fetch(CONFIG.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: history.slice(-CONFIG.maxContext)
                })
            }).then(function (res) {
                return res.json().catch(function () { return {}; });
            }).then(function (data) {
                typing.remove();
                if (data && typeof data.reply === 'string' && data.reply) {
                    history.push({ role: 'assistant', content: data.reply });
                    addBubble('assistant', data.reply);
                    saveHistory();
                } else if (data && data.error === 'rate') {
                    addBubble('sys', '聊得有点快啦，歇一分钟再来～');
                } else if (data && data.error === 'busy') {
                    addBubble('sys', '小鱼现在有点忙，稍等一下下～');
                } else {
                    addBubble('sys', CONFIG.offlineTip, offlineURL);
                }
            }).catch(function () {
                typing.remove();
                addBubble('sys', CONFIG.offlineTip, offlineURL);
            }).then(function () {
                sending = false;
                sendBtn.disabled = false;
            });
        });
    }

    /* ---------------- 启动 ---------------- */
    function boot() {
        watchImages();
        loadHistory();
        buildWidget();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
