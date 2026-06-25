import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { db } from "./db";
import { authConfig } from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, _request) {
        console.log("[AUTH] Starting authorization for:", credentials?.email);
        
        if (!credentials?.email || !credentials?.password) {
          console.log("[AUTH] Missing email or password");
          return null;
        }

        const user = await db.user.findUnique({
          where: { email: credentials.email as string },
          include: { role: true, tenant: true },
        });

        console.log("[AUTH] User found:", !!user);
        if (user) {
          console.log("[AUTH] User ID:", user.id);
          console.log("[AUTH] Has password:", !!user.password);
          console.log("[AUTH] Has role:", !!user.role);
        }

        if (!user || !user.password) {
          console.log("[AUTH] User not found or no password");
          return null;
        }

        const isValid = await compare(
          credentials.password as string,
          user.password
        );

        console.log("[AUTH] Password valid:", isValid);

        if (!isValid) {
          console.log("[AUTH] Invalid password");
          return null;
        }

        // 确保角色存在
        if (!user.role) {
          console.error(`[AUTH] User ${user.email} has no role assigned`);
          return null;
        }

        console.log("[AUTH] Updating lastLoginAt...");
        await db.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        console.log("[AUTH] Returning user data");
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          tenantId: user.tenantId ?? undefined,
          tenantName: user.tenant?.name ?? '',
          tenantSlug: user.tenant?.slug ?? '',
          roleId: user.roleId,
          roleName: user.role.name,
          permissions: user.role.permissions as string[],
        };
      },
    }),
  ],
});
