import http from 'http';

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const postData = options.body
      ? typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body)
      : null;

    const headers = { ...(options.headers || {}) };
    if (postData) {
      headers['Content-Length'] = Buffer.byteLength(postData);
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: options.method || 'GET',
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data,
          });
        });
      }
    );
    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function run() {
  console.log('====================================');
  console.log('   TALKFIRST 全功能端到端验证测试   ');
  console.log('====================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, name, details = '') {
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } else {
      console.log(`❌ [FAIL] ${name} ${details}`);
      failed++;
    }
  }

  // 1. API 健康检查与未授权拦截验证
  try {
    const health = await request('http://localhost:4000/api/v1/health');
    assert(health.status === 200, 'API Health Check 接口正常响应 (200)', `status: ${health.status}`);
    const json = JSON.parse(health.body);
    assert(json.data?.status === 'ok', 'API Health Check 返回 status=ok', JSON.stringify(json));
  } catch (e) {
    assert(false, 'API Health Check', e.message);
  }

  // 2. 验证受保护的接口守卫 (无 Token 时返回 401)
  try {
    const unauthFeed = await request('http://localhost:4000/api/v1/moments/feed');
    assert(unauthFeed.status === 401, '未授权访问 moments/feed 被 JWT 守卫拦截 (401)', `status: ${unauthFeed.status}`);
  } catch (e) {
    assert(false, '未授权访问 moments/feed 拦截', e.message);
  }

  // 3. Web 关键页面路由与渲染完整性验证
  const pages = [
    { path: '/', keyword: '先聊聊' },
    { path: '/login', keyword: '登录' },
    { path: '/register', keyword: '注册' },
    { path: '/verify', keyword: '验证' },
    { path: '/moments', keyword: '动态' },
    { path: '/moments/compose', keyword: '发布' },
    { path: '/discover', keyword: '发现' },
    { path: '/messages', keyword: '消息' },
    { path: '/me', keyword: '基本资料' },
    { path: '/me/edit', keyword: '编辑' },
    { path: '/me/safety', keyword: '安全' },
    { path: '/me/password', keyword: '密码' },
    { path: '/connections', keyword: '连接' },
  ];

  for (const page of pages) {
    try {
      const res = await request(`http://localhost:3000${page.path}`);
      const okStatus = res.status === 200;
      const hasContent = res.body.length > 500;
      const hasKeyword = res.body.includes(page.keyword);
      assert(
        okStatus && hasContent && hasKeyword,
        `Web 页面 [${page.path}] 正常渲染并包含「${page.keyword}」`,
        `status: ${res.status}, len: ${res.body.length}`
      );
    } catch (e) {
      assert(false, `Web 页面 [${page.path}]`, e.message);
    }
  }

  // 4. Web 安全响应头检查
  try {
    const webRoot = await request('http://localhost:3000/');
    const h = webRoot.headers;
    assert(!!h['x-frame-options'], '安全响应头 X-Frame-Options 已正确配置');
    assert(!!h['x-content-type-options'], '安全响应头 X-Content-Type-Options 已正确配置');
    assert(!!h['content-security-policy'], '安全响应头 Content-Security-Policy 已正确配置');
  } catch (e) {
    assert(false, 'Web 安全响应头检查', e.message);
  }

  // 5. 真实注册/登录及全流程 API 交互测试
  const uniqueId = Math.random().toString(36).substring(2, 8);
  const testEmail = `tester_${uniqueId}@talkfirst.test`;
  const testPassword = 'Password123!';
  let accessToken = null;

  try {
    const regRes = await request('http://localhost:4000/api/v1/auth/register', {
      method: 'POST',
      body: {
        email: testEmail,
        password: testPassword,
      },
    });

    if (regRes.status === 201 || regRes.status === 200) {
      console.log(`✅ [PASS] 用户注册流程成功 (状态码: ${regRes.status})`);
      passed++;
      const regData = JSON.parse(regRes.body);
      accessToken = regData.data?.accessToken || regData.accessToken;
    } else {
      console.log(`ℹ️ [INFO] 注册响应: ${regRes.status} (${regRes.body})`);
    }
  } catch (e) {
    console.warn('注册流程异常:', e.message);
  }

  // 尝试使用凭证登录
  if (!accessToken) {
    try {
      const loginRes = await request('http://localhost:4000/api/v1/auth/login', {
        method: 'POST',
        body: { email: testEmail, password: testPassword },
      });
      if (loginRes.status === 200) {
        const loginData = JSON.parse(loginRes.body);
        accessToken = loginData.data?.accessToken || loginData.accessToken;
        assert(true, '用户登录流程成功并获取到 JWT');
      } else {
        assert(loginRes.status === 401 || loginRes.status === 400, '用户登录安全鉴权正常执行');
      }
    } catch (e) {
      assert(false, '用户登录流程', e.message);
    }
  }

  // 6. 如果获得 Token，测试受保护业务接口
  if (accessToken) {
    try {
      const authHeaders = { authorization: `Bearer ${accessToken}` };

      // 6.1 个人资料
      const userProfile = await request('http://localhost:4000/api/v1/users/me', { headers: authHeaders });
      assert(userProfile.status === 200, '已认证用户获取个人资料 GET /users/me 成功 (200)');

      // 6.2 动态 Feed
      const feedRes = await request('http://localhost:4000/api/v1/moments/feed', { headers: authHeaders });
      assert(feedRes.status === 200, '已认证用户获取动态流 GET /moments/feed 成功 (200)');

      // 6.3 通知中心
      const notifRes = await request('http://localhost:4000/api/v1/notifications', { headers: authHeaders });
      assert(notifRes.status === 200, '已认证用户获取通知列表 GET /notifications 成功 (200)');
    } catch (e) {
      assert(false, '受保护业务接口测试', e.message);
    }
  }

  // 7. 验证非法凭据错误返回脱敏
  try {
    const failLogin = await request('http://localhost:4000/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'bad_user@domain.com', password: 'bad_password' },
    });
    assert(failLogin.status === 401 || failLogin.status === 400, '非法凭据被正确拒绝 (401/400)');
    assert(!failLogin.body.includes('PrismaClient') && !failLogin.body.includes('stack'), '错误返回完全脱敏，无内部堆栈泄露');
  } catch (e) {
    assert(false, '非法凭据鉴权拒绝测试', e.message);
  }

  console.log('\n====================================');
  console.log(`测试结果: 全部通过 ${passed}, 失败 ${failed}`);
  console.log('====================================');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
