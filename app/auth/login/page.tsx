import { LoginForm } from "@/components/login-form"

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0f1c] p-6">
      <div className="w-full max-w-md">
        <LoginForm />
      </div>
    </div>
  )
}

