import { issuer } from "@openauthjs/openauth";
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare";
import { PasswordProvider } from "@openauthjs/openauth/provider/password";
import { PasswordUI } from "@openauthjs/openauth/ui/password";
import { createSubjects } from "@openauthjs/openauth/subject";
import { object, string } from "valibot";

// Perluas subject untuk menyertakan roomId, nama, dan username
const subjects = createSubjects({
	user: object({
		id: string(),
		roomId: string(),
		nama: string(),
		username: string(),
	}),
});

// Fungsi untuk menghasilkan roomId permanen dari email
async function hashEmailToRoomId(email: string): Promise<string> {
	const encoder = new TextEncoder();
	const salt = 'READTALK_PERMANENT_SALT';
	const data = encoder.encode(email + salt);
	const hash = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hash));
	const hashB64 = btoa(String.fromCharCode(...hashArray));
	return hashB64
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '')
		.substring(0, 21);
}

// Fungsi utama: dapatkan atau buat user dengan semua data
async function getOrCreateUser(env: Env, email: string): Promise<{id: string, roomId: string, nama: string, username: string}> {
	const roomId = await hashEmailToRoomId(email);
	// Untuk nama dan username, bisa di-generate dari email atau dikosongkan dulu
	const nama = ''; // Atau ambil dari input user jika ada
	const username = email.split('@')[0]; // Contoh: buat username dari bagian sebelum '@'

	const result = await env.AUTH_DB.prepare(
		`
		INSERT INTO user (email, room_id, nama, username)
		VALUES (?, ?, ?, ?)
		ON CONFLICT (email) DO UPDATE SET
			room_id = COALESCE(room_id, excluded.room_id),
			nama = COALESCE(nama, excluded.nama),
			username = COALESCE(username, excluded.username)
		RETURNING id, room_id, nama, username;
		`
	)
		.bind(email, roomId, nama, username)
		.first<{ id: string, room_id: string, nama: string, username: string }>();
	
	if (!result) {
		throw new Error(`Unable to process user: ${email}`);
	}
	console.log(`User ${result.id} with email ${email}, roomId: ${result.room_id}`);
	return {
		id: result.id,
		roomId: result.room_id,
		nama: result.nama,
		username: result.username
	};
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);
		if (url.pathname === "/") {
			url.searchParams.set("redirect_uri", url.origin + "/callback");
			url.searchParams.set("client_id", "your-client-id");
			url.searchParams.set("response_type", "code");
			url.pathname = "/authorize";
			return Response.redirect(url.toString());
		} else if (url.pathname === "/callback") {
			return Response.json({
				message: "OAuth flow complete!",
				params: Object.fromEntries(url.searchParams.entries()),
			});
		}

		return issuer({
			storage: CloudflareStorage({
				namespace: env.AUTH_STORAGE,
			}),
			subjects,
			providers: {
				password: PasswordProvider(
					PasswordUI({
						sendCode: async (email, code) => {
							console.log(`Sending code ${code} to ${email}`);
						},
						copy: {
							input_code: "Code (check Worker logs)",
						},
					}),
				),
			},
			theme: {
				title: "READTalk - Lock",
				primary: "#ff0000",
				favicon: "https://readtalk.vercel.app/favicon.ico",
				logo: {
					dark: "https://readtalk.vercel.app/brand-assets.png",
					light: "https://readtalk.vercel.app/brand-assets.png",
				},
			},
			success: async (ctx, value) => {
				const user = await getOrCreateUser(env, value.email);
				return ctx.subject("user", {
					id: user.id,
					roomId: user.roomId,
					nama: user.nama,
					username: user.username
				});
			},
		}).fetch(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
