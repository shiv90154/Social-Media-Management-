import NextAuth from "next-auth";
import { authConfig } from "@smm/auth";

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
