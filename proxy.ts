import { NextResponse, type NextRequest } from "next/server";

/**
 * Legacy workspace URLs (`/w/<projectId>/<module>`) redirect to the clean
 * section URLs (`/<module>`), with the visited project recalled in a cookie so
 * every module page renders against the project the user opened last.
 *
 * "register" keeps its spoken name in the tree: /data-register.
 */
export function proxy(request: NextRequest) {
  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  const projectId = segments[1] ?? "";
  let module = segments.slice(2).join("/") || "pbs";
  if (module === "register") module = "data-register";
  if (module === "mttr") module = "data-register";

  const response = NextResponse.redirect(
    new URL(`/${module}${request.nextUrl.search}`, request.nextUrl.origin),
  );
  if (projectId) {
    response.cookies.set("relia_project", projectId, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 180,
    });
  }
  return response;
}

export const config = {
  matcher: ["/w/:path*"],
};
