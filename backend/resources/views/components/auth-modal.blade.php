<style>
/* Modal Overlay Setup */
.custom-auth-modal-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.6);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 9999;
}
.custom-auth-modal-overlay.active {
    display: flex;
}
.custom-auth-modal-overlay .auth-card {
    position: relative;
    max-height: 90vh;
    overflow-y: auto;
}
.close-modal-btn {
    position: absolute;
    top: 15px; right: 15px;
    background: none; border: none; font-size: 24px; cursor: pointer; color: #777;
}
.google-btn {
    width: 100%; padding: 12px; margin-top: 15px; border-radius: 8px; border: 1px solid #ccc;
    background: white; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px;
    transition: 0.2s;
}
.google-btn:hover { background: #f9f9f9; }
.auth-form { display: none; }
.auth-form.active { display: block; }
</style>
<div class="custom-auth-modal-overlay" id="userAuthModal">
    <div class="auth-card">
        <button class="close-modal-btn" onclick="document.getElementById('userAuthModal').classList.remove('active')">&times;</button>
        <div class="card-accent"></div>
        <div class="auth-hero" style="text-align: center;">
            <h1 class="auth-title">Welcome</h1>
            <p class="auth-caption">UCN-FMRC Customer Portal</p>
        </div>

        <!-- Login Form -->
        <form class="auth-form active" id="modalLoginForm" method="POST" action="{{ route('login') }}">
            @csrf
            <h2 class="form-heading" style="text-align: center; margin-bottom: 20px;">Log In</h2>
            <div class="input-wrapper">
                <label for="loginUser">Email or Username</label>
                <div class="input-icon-group">
                    <input id="loginUser" name="loginUser" type="text" placeholder="Enter your email or username" required />
                </div>
            </div>
            <div class="input-wrapper">
                <label for="loginPass">Password</label>
                <div class="password-field input-icon-group">
                    <input id="loginPass" name="password" type="password" placeholder="Enter your password" required />
                </div>
            </div>
            <div class="form-link-wrap"><a href="#" class="form-link">Forgot Password?</a></div>
            <button class="auth-btn" type="submit" style="background:#9e1414; color:white; width:100%; padding:14px; border-radius:8px; border:none; font-weight:bold; cursor:pointer;">Log In</button>
            
            <button type="button" class="google-btn">
                <svg width="20" height="20" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.51 38.02 46.98 31.81 46.98 24.55z"></path>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                </svg> Continue with Google
            </button>

            <p class="switch-copy" style="text-align: center; margin-top:20px;">
                No account yet? <button type="button" class="inline-link" onclick="toggleAuth('register')" style="border:none; background:none; color:#C0392B; cursor:pointer; font-weight:bold;">Sign Up</button>
            </p>
        </form>

        <!-- Register Form -->
        <form class="auth-form" id="modalRegisterForm" method="POST" action="{{ route('register') }}">
            @csrf
            <h2 class="form-heading" style="text-align: center; margin-bottom: 20px;">Create Account</h2>
            <div class="input-wrapper">
                <label for="signupUser">Username</label>
                <div class="input-icon-group">
                    <input id="signupUser" name="username" type="text" placeholder="Create your username" required />
                </div>
            </div>
            <div class="input-wrapper">
                <label for="signupPass">Password</label>
                <div class="password-field input-icon-group">
                    <input id="signupPass" name="password" type="password" placeholder="Create a password" required />
                </div>
            </div>
            <div class="input-wrapper">
                <label for="signupConfirm">Confirm Password</label>
                <div class="password-field input-icon-group">
                    <input id="signupConfirm" name="password_confirmation" type="password" placeholder="Re-enter password" required />
                </div>
            </div>
            <button class="auth-btn" type="submit" style="background:#9e1414; color:white; width:100%; padding:14px; border-radius:8px; border:none; font-weight:bold; cursor:pointer;">Create Account</button>
            <p class="switch-copy" style="text-align: center; margin-top:20px;">
                Already have an account? <button type="button" class="inline-link" onclick="toggleAuth('login')" style="border:none; background:none; color:#C0392B; cursor:pointer; font-weight:bold;">Log In</button>
            </p>
        </form>
    </div>
</div>

<script>
function toggleAuth(mode) {
    if (mode === 'register') {
        document.getElementById('modalLoginForm').classList.remove('active');
        document.getElementById('modalRegisterForm').classList.add('active');
    } else {
        document.getElementById('modalRegisterForm').classList.remove('active');
        document.getElementById('modalLoginForm').classList.add('active');
    }
}
document.querySelector('.user-profile').addEventListener('click', function(e) {
    e.preventDefault();
    document.getElementById('userAuthModal').classList.add('active');
});
</script>
