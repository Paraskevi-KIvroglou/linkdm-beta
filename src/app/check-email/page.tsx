export default function CheckEmailPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-md p-8">
        <div className="text-5xl mb-4">📬</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Check your inbox</h1>
        <p className="text-gray-600 mb-2">We sent you a magic link. Click it to log in.</p>
        <p className="text-sm text-gray-400">
          It expires in 15 minutes. Didn't get it? Check your spam folder or{" "}
          <a href="/login" className="text-blue-600 hover:underline">try again</a>.
        </p>
      </div>
    </main>
  );
}
