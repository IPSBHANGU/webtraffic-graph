import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function SignupSuccessPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0f1c] p-6">
      <Card className="w-full max-w-md border-white/10 bg-white/5 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-2xl text-white">Check your email</CardTitle>
          <CardDescription className="text-white/60">
            We&apos;ve sent you a confirmation link to verify your email address.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-white/70">
            Please check your inbox and click the confirmation link to complete your
            signup.
          </p>
          <Button asChild className="w-full">
            <Link href="/auth/login">Back to Login</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

