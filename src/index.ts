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

// Generate permanent deterministic roomId from email
async function hashEmailToRoomId(email: string): Promise<string> {
	const encoder = new TextEncoder();
	const salt = 'READTALK_PERMANENT_SALT_DO_NOT_CHANGE';
	const data = encoder.encode(email + salt);

	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashB64 = btoa(String.fromCharCode(...hashArray));

	return hashB64
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '')
		.substring(0, 21);
}

// Get or create user with permanent roomId
async function getOrCreateUserWithRoom(env: Env, email: string): Promise<{ id: string; roomId: string }> {
	const roomId = await hashEmailToRoomId(email);

	const existingUser = await env.AUTH_DB.prepare(
		`SELECT id, room_id FROM user WHERE email = ?`
	)
		.bind(email)
		.first<{ id: string; room_id: string | null }>();

	if (existingUser) {
		if (existingUser.room_id && existingUser.room_id !== roomId) {
			// Keep existing roomId if conflict (should not happen with same salt)
			return { id: existingUser.id, roomId: existingUser.room_id };
		}

		if (!existingUser.room_id || existingUser.room_id !== roomId) {
			await env.AUTH_DB.prepare(`UPDATE user SET room_id = ? WHERE email = ?`)
				.bind(roomId, email)
				.run();
		}

		return { id: existingUser.id, roomId: roomId };
	}

	const result = await env.AUTH_DB.prepare(
		`INSERT INTO user (email, room_id) VALUES (?, ?) RETURNING id`
	)
		.bind(email, roomId)
		.first<{ id: string }>();

	if (!result) {
		throw new Error(`Failed to create user for email: ${email}`);
	}

	return { id: result.id, roomId: roomId };
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		// Quick test endpoint: get roomId for any email
		if (url.pathname === '/get-room') {
			const email = url.searchParams.get('email');
			if (!email) {
				return new Response('Parameter ?email= required', { status: 400 });
			}
			try {
				const roomId = await hashEmailToRoomId(email);
				return Response.json({
					email: email,
					permanentRoomId: roomId,
					chatUrl: `https://chat.readtalk.workers.dev/${roomId}`,
				});
			} catch (error) {
				return new Response(`Error: ${error.message}`, { status: 500 });
			}
		}

		// Demo endpoints from template
		if (url.pathname === '/') {
			url.searchParams.set('redirect_uri', url.origin + '/callback');
			url.searchParams.set('client_id', 'readtalk-client');
			url.searchParams.set('response_type', 'code');
			url.pathname = '/authorize';
			return Response.redirect(url.toString());
		} else if (url.pathname === '/callback') {
			return Response.json({
				message: 'OAuth flow complete',
				params: Object.fromEntries(url.searchParams.entries()),
			});
		}

		// Main OpenAuth server with permanent roomId
		return issuer({
			storage: CloudflareStorage({
				namespace: env.AUTH_STORAGE,
			}),
			subjects,
			providers: {
				password: PasswordProvider(
					PasswordUI({
						sendCode: async (email, code) => {
							console.log(`Verification code for ${email}: ${code}`);
						},
						copy: {
							input_code: 'Code (check Worker logs)',
						},
					}),
				),
			},
			theme: {
				title: 'READTalk Authentication',
				primary: '#ff0000',
				favicon: 'https://readtalk.vercel.app/favicon.ico',
				logo: {
					dark: 'https://readtalk.vercel.app/brand-assets.png',
					light: 'https://readtalk.vercel.app/brand-assets.png',
				},
			},
			success: async (ctx, value) => {
				const { id, roomId } = await getOrCreateUserWithRoom(env, value.email);
				return ctx.subject('user', {
					id: id,
					roomId: roomId,
				});
			},
		}).fetch(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
