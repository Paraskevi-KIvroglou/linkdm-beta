import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  isAuthenticatedNextjs,
  redirectToSignIn,
} from "@convex-dev/auth/nextjs/server";

const isPublicPage = createRouteMatcher([
  "/",
  "/login",
  "/waitlist",
  "/check-email",
]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  if (!isPublicPage(request) && !(await convexAuth.isAuthenticated())) {
    return redirectToSignIn(request);
  }
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
