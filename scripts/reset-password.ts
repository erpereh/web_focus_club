/**
 * Reset password using Firebase client SDK approach:
 * 1. Try to create a new account (will fail if exists)
 * 2. If exists, send a password reset email
 * 3. Alternatively, delete and recreate
 */

const API_KEY = 'AIzaSyAybBtOavxRoZ2unWpl5lVxFtOyxT8KksI';
const EMAIL = 'david.perez.iglesias2004@gmail.com';
const NEW_PASSWORD = 'focus2026';

async function main() {
    console.log('🔑 Reseteando contraseña...\n');

    try {
        // Try to send password reset email
        console.log('📩 Enviando email de restablecimiento...');
        const resetRes = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requestType: 'PASSWORD_RESET',
                    email: EMAIL,
                }),
            }
        );

        const resetData = await resetRes.json();

        if (resetRes.ok) {
            console.log('✅ Email de restablecimiento enviado a:');
            console.log(`   ${EMAIL}\n`);
            console.log('📌 Pero como necesitas una contraseña específica,');
            console.log('   voy a intentar borrar y recrear la cuenta...\n');
        } else {
            console.log('ℹ️  Reset email result:', resetData.error?.message || 'unknown');
        }

        // Now try sign up (will tell us if account exists)
        console.log('🔄 Intentando crear cuenta nueva...');
        const signUpRes = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: EMAIL,
                    password: NEW_PASSWORD,
                    returnSecureToken: true,
                }),
            }
        );

        const signUpData = await signUpRes.json();

        if (signUpRes.ok) {
            console.log('✅ ¡Cuenta creada! (la anterior no existía o se eliminó)');
            console.log(`   UID: ${signUpData.localId}`);
            console.log(`   Email: ${EMAIL}`);
            console.log(`   Password: ${NEW_PASSWORD}`);
        } else {
            console.log(`⚠️  ${signUpData.error?.message}`);

            if (signUpData.error?.message === 'EMAIL_EXISTS') {
                console.log('\n📩 La cuenta ya existe en Firebase Auth.');
                console.log('   Revisa tu correo para el link de restablecimiento.');
                console.log('   O bien, borra el usuario manualmente desde:');
                console.log('   https://console.firebase.google.com/project/focus-club-252dc/authentication/users');
                console.log('   y luego regístrate de nuevo con la contraseña: focus2026');
            }
        }
    } catch (error: any) {
        console.error('❌ Error de red:', error.message);
    }

    process.exit(0);
}

main();
