// Isolated Google SDK and FMRC API fixtures: no Google account or real session is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const {browserFixture, chrome} = require('./helpers/website-browser.cjs');

for (const prefix of ['', '/apps/customer']) {
  test(`Google sign-in explains popup failures and recovers on ${prefix || 'website'}`, {skip: !chrome, timeout: 60000}, async t => {
    const submissions = [];
    let authResponse = {message: 'Google token expired. Please try again.'}, authStatus = 401;
    const h = await browserFixture(t, async ({req, route, json}) => {
      if (route === '/api/security-config') {json({turnstile: {enabled: false, site_key: null}}); return true;}
      if (route === '/api/auth/google') {
        let body = ''; for await (const chunk of req) body += chunk;
        submissions.push(JSON.parse(body)); json(authResponse, authStatus); return true;
      }
      return false;
    });
    await h.send('Network.setBlockedURLs', {urls: ['https://*']});
    await h.send('Page.addScriptToEvaluateOnNewDocument', {source: `
      const fixtureFetch=window.fetch.bind(window);
      window.fetch=(input,options)=>fixtureFetch(typeof input==='string'&&input.startsWith(location.protocol+'//'+location.hostname+':8000/api/')?location.origin+input.slice(input.indexOf('/api/')):input,options);
      window.googleRequests=0;
      window.googleInitializations=0;
      window.installGoogleFixture=()=>{window.google={accounts:{oauth2:{initTokenClient:config=>{
        window.googleTokenConfig=config;window.googleInitializations++;
        return {requestAccessToken:options=>{window.googleRequests++;window.googleRequestOptions=options;}};
      }},id:{initialize:config=>{window.googleCredentialConfig=config;},prompt:()=>{window.googlePrompts=(window.googlePrompts||0)+1;}}}};};
    `});
    await h.go(prefix + '/customer-auth/auth.html');
    await h.until(`typeof document.querySelector('#loginForm .google-auth-btn').onclick==='function'`);
    const clickLogin = `document.querySelector('#loginForm .google-auth-btn').click()`;
    const message = text => `document.querySelector('.auth-error-item')?.textContent.includes(${JSON.stringify(text)})`;
    await h.run(`document.getElementById('loginUser').value='customer@example.test';document.getElementById('loginPass').value='KeepMyEntry';${clickLogin}`);
    await h.until(message('could not load'));
    assert.equal(submissions.length, 0);
    assert.equal(await h.run(`document.getElementById('loginPass').value`), 'KeepMyEntry');

    // Loading later can recover without a reload, and rapid clicks open one popup.
    await h.run(`installGoogleFixture();${clickLogin};${clickLogin}`);
    assert.equal(await h.run('googleRequests'), 1);
    assert.equal(await h.run('googleInitializations'), 1);
    assert.equal(await h.run('googleTokenConfig.scope'), 'openid email profile');
    assert.equal(await h.run('googleTokenConfig.client_id===googleCredentialConfig.client_id'), true);
    await h.run(`googleTokenConfig.error_callback({type:'popup_failed_to_open'})`);
    await h.until(message('Allow popups'));
    await h.run(`${clickLogin};googleTokenConfig.callback({error:'origin_mismatch'})`);
    await h.until(message('not configured for this website address'));
    assert.equal(submissions.length, 0);
    await h.run(`${clickLogin};googleTokenConfig.callback(null)`);
    await h.until(message('was not completed'));

    // A failed provider login stays on the form and permits another attempt.
    await h.run(`${clickLogin};googleTokenConfig.callback({access_token:'fixture-google-token'})`);
    await h.until(message('Google token expired'));
    assert.deepEqual(submissions, [{access_token: 'fixture-google-token'}]);
    assert.equal(await h.run(`document.getElementById('loginUser').value`), 'customer@example.test');
    assert.equal(await h.run(`document.getElementById('loginPass').value`), 'KeepMyEntry');

    // Signup uses the same callbacks without contaminating or submitting password forms.
    await h.run(`document.getElementById('openSignupFromLogin').click();document.querySelector('#signupForm .google-auth-btn').click();googleTokenConfig.error_callback({type:'popup_closed'})`);
    await h.until(message('was not completed'));
    assert.equal(await h.run(`document.getElementById('signupName').getAttribute('aria-invalid')`), 'true');
    await h.shot('google-popup-error');

    authStatus = 200;
    authResponse = {access_token: 'fixture_customer_session', user: {id: 33, role: 'customer', email: 'customer@example.test', signed_with_google: true, has_custom_password: false}};
    await h.run(`document.getElementById('openLoginFromSignup').click();${clickLogin};googleCredentialConfig.callback({credential:'fixture-google-id-token'})`);
    await h.until(`location.pathname==='${prefix}/home-page/'`);
    assert.deepEqual(submissions.at(-1), {id_token: 'fixture-google-id-token'});
    assert.equal(await h.run(`localStorage.getItem('customer_token')`), 'fixture_customer_session');
    assert.equal(await h.run(`JSON.parse(localStorage.getItem('customer_info')).signed_with_google`), true);
    assert.deepEqual(await h.run('fixtureErrors'), []);
  });
}
