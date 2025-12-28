import { issuer } from "@openauthjs/openauth";
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare";
import { PasswordProvider } from "@openauthjs/openauth/provider/password";
import { PasswordUI } from "@openauthjs/openauth/ui/password";
import { createSubjects } from "@openauthjs/openauth/subject";
import { object, string } from "valibot";

const subjects = createSubjects({
	user: object({
		id: string(),
		roomId: string(),
	}),
});

async function hashEmailToRoomId(email: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(email + 'READTALK_PERMANENT_SALT');
	const hash = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hash));
	const hashB64 = btoa(String.fromCharCode(...hashArray));
	return hashB64
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '')
		.substring(0, 21);
}

async function getOrCreateUser(env: Env, email: string): Promise<string> {
	const result = await env.AUTH_DB.prepare(
		`INSERT INTO user (email, room_id) VALUES (?, ?)
		 ON CONFLICT (email) DO UPDATE SET email = email
		 RETURNING id`
	)
		.bind(email, await hashEmailToRoomId(email))
		.first<{ id: string }>();
	
	if (!result) throw new Error(`Gagal untuk: ${email}`);
	return result.id;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);
		
		if (url.pathname === "/") {
			url.searchParams.set("redirect_uri", url.origin + "/callback");
			url.searchParams.set("client_id", "your-client-id");
			url.searchParams.set("response_type", "code");
			url.pathname = "/authorize";
			return Response.redirect(url.toString());
		} else if (url.pathname === "/callback") {
			return Response.json({
				message: "OAuth flow selesai",
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
							console.log(`Kode ${code} untuk ${email}`);
						},
						copy: {
							input_code: "Kode (lihat log)",
						},
					}),
				),
			},
			theme: {
				title: "READTalk Authentication",
				primary: "#ff0000",
				favicon: "https://readtalk.vercel.app/favicon.ico",
				logo: {
					dark: "https://readtalk.vercel.app/brand-assets.png",
					light: "https://readtalk.vercel.app/brand-assets.png",
				},
			},
			success: async (ctx, value) => {
				const userId = await getOrCreateUser(env, value.email);
				const roomId = await hashEmailToRoomId(value.email);
				
				return ctx.subject("user", {
					id: userId,
					roomId: roomId,
				});
			},
		}).fetch(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
