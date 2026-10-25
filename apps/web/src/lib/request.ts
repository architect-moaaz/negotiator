export function requestCity(request: Request) {
  const raw = request.headers.get("x-vercel-ip-city");
  return raw ? decodeURIComponent(raw) : undefined;
}
