import Button from "@/components/Button";
import Card from "@/components/Card";
import Input from "@/components/Input";

export default function Home() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">UniTrack</h1>
      <p>University equipment borrowing and management.</p>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Shared components">
          <div className="flex flex-col gap-3">
            <Input id="demo" label="Example field" placeholder="Type here" />
            <div className="flex flex-wrap gap-2">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
            </div>
          </div>
        </Card>
        <Card title="Responsive layout">
          <p>Single column on phones, two columns on larger screens.</p>
        </Card>
      </div>
    </div>
  );
}