import { SignupForm } from "@/components/signup-form"

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0f1c] p-6">
      <div className="w-full max-w-md">
        <SignupForm />
      </div>
    </div>
  )
}

