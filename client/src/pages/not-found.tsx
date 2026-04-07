import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md mx-4 bg-card border-border shadow-2xl">
        <CardContent className="pt-6 pb-6">
          <div className="flex mb-4 gap-2 text-destructive font-bold text-2xl items-center justify-center">
            <AlertCircle className="w-8 h-8" />
            <h1>404 Page Not Found</h1>
          </div>

          <p className="mt-4 text-muted-foreground text-center">
            The page you are looking for does not exist or has been moved.
          </p>

          <div className="mt-8 flex justify-center">
            <Link href="/">
              <Button className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/25">
                Return to Dashboard
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
