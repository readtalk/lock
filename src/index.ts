import { issuer } from "@openauthjs/openauth";
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare";
import { PasswordProvider } from "@openauthjs/openauth/provider/password";
import { PasswordUI } from "@openauthjs/openauth/ui/password";
import { createSubjects } from "@openauthjs/openauth/subject";
import { object, string } from "valibot";

const subjects = createSubjects({
	user: object({
		id: string(),
	}),
});

// Base64 encoded chat.readtalk URL
const CHAT_BASE_URL = 'aHR0cHM6Ly9jaGF0LnJlYWR0YWxrLndvcmtlcnMuZGV2';

async function getOrCreateUser(env: Env, email: string): Promise<string> {
	const result = await env.AUTH_DB.prepare(
		`INSERT INTO user (email) VALUES (?)
		 ON CONFLICT (email) DO UPDATE SET email = email
		 RETURNING id`
	)
		.bind(email)
		.first<{ id: string }>();
	
	if (!result) throw new Error(`Unable to process user: ${email}`);
	return result.id;
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
				const userId = await getOrCreateUser(env, value.email);
				
				// Decode base64 URL dan redirect
				const chatUrl = atob(CHAT_BASE_URL) + '/' + userId;
				return Response.redirect(chatUrl);
			},
		}).fetch(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
