"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Zap,
  CheckCircle2,
  ArrowLeft,
  Mail,
  MessageSquare,
  Building2,
  Clock3,
  Compass,
  Target,
} from "lucide-react";

const fitSignals = [
  "适合制造业、工业品、设备与技术服务型出海企业",
  "适合已经在做独立站、展会、外贸销售，但增长动作仍然分散的团队",
  "我们先判断最小增长闭环，再讨论是否进入正式实施",
];

const processSignals = [
  {
    icon: Clock3,
    label: "响应节奏",
    value: "1 个工作日内",
    detail: "收到信息后安排首次沟通。",
  },
  {
    icon: Compass,
    label: "诊断方式",
    value: "先看问题，再谈方案",
    detail: "不先卖账号，先判断你们应该先搭哪条增长闭环。",
  },
  {
    icon: Target,
    label: "输出结果",
    value: "带走一版启动建议",
    detail: "包括优先模块、实施顺序和近期可验证动作。",
  },
];

export default function InquiryPage() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get("name") as string,
      company: formData.get("company") as string,
      email: formData.get("email") as string,
      phone: formData.get("phone") as string,
      message: [
        formData.get("industry")
          ? `所属行业：${formData.get("industry") as string}`
          : null,
        formData.get("market")
          ? `目标市场：${formData.get("market") as string}`
          : null,
        formData.get("priority")
          ? `当前优先问题：${formData.get("priority") as string}`
          : null,
        formData.get("message")
          ? `补充说明：${formData.get("message") as string}`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
    };

    try {
      const res = await fetch("/api/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        setSubmitted(true);
      } else {
        const result = await res.json();
        setError(result.error || "提交失败，请稍后重试");
      }
    } catch {
      setError("网络错误，请检查连接后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex"
      style={{
        background:
          "linear-gradient(135deg, #0B1220 0%, #1a1a2e 50%, #0B1220 100%)",
      }}
    >
      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 60% at 30% 50%, rgba(212,175,55,0.15) 0%, transparent 70%)",
          }}
        />
        <div className="absolute top-20 left-20 w-64 h-64 rounded-full border border-[rgba(212,175,55,0.1)]" />
        <div className="absolute top-40 left-40 w-48 h-48 rounded-full border border-[rgba(212,175,55,0.08)]" />
        <div className="absolute bottom-40 right-20 w-96 h-96 rounded-full border border-[rgba(212,175,55,0.05)]" />

        <div className="relative z-10 flex flex-col justify-center px-16 w-full">
          <div className="mb-8">
            <div className="flex items-center gap-4">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{
                  background:
                    "linear-gradient(135deg, #D4AF37 0%, #C5A030 100%)",
                  boxShadow: "0 8px 32px -8px rgba(212,175,55,0.4)",
                }}
              >
                <Zap className="w-8 h-8" style={{ color: "#0B1220" }} />
              </div>
              <div>
                <h1
                  className="text-3xl font-bold"
                  style={{ color: "#D4AF37" }}
                >
                  VertaX
                </h1>
                <p
                  className="text-sm"
                  style={{ color: "rgba(255,255,255,0.6)" }}
                >
                  GTM Intelligence OS
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <h2
              className="text-4xl font-bold leading-tight"
              style={{ color: "#ffffff" }}
            >
              先把你们的出海增长
              <br />
              <span style={{ color: "#D4AF37" }}>诊断清楚再启动</span>
            </h2>
            <p
              className="text-lg leading-relaxed"
              style={{ color: "rgba(255,255,255,0.7)" }}
            >
              VertaX 不是开放自助试用账号，而是先判断你们当前最值得先搭的增长闭环。
              <br />
              留下信息，我们会按行业、目标市场和当前瓶颈准备一次更像样的增长诊断。
            </p>
          </div>

          <div className="mt-12 space-y-4">
            {fitSignals.map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <CheckCircle2
                  className="w-5 h-5"
                  style={{ color: "#D4AF37" }}
                />
                <span
                  className="text-base"
                  style={{ color: "rgba(255,255,255,0.8)" }}
                >
                  {item}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-10 grid gap-3">
            {processSignals.map((signal) => {
              const Icon = signal.icon;

              return (
                <div
                  key={signal.label}
                  className="rounded-2xl p-4"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                      style={{ background: "rgba(212,175,55,0.12)" }}
                    >
                      <Icon className="h-5 w-5" style={{ color: "#D4AF37" }} />
                    </div>
                    <div>
                      <p
                        className="text-xs uppercase tracking-[0.18em]"
                        style={{ color: "rgba(255,255,255,0.45)" }}
                      >
                        {signal.label}
                      </p>
                      <p className="mt-1 text-base font-semibold" style={{ color: "#ffffff" }}>
                        {signal.value}
                      </p>
                      <p className="mt-1 text-sm leading-6" style={{ color: "rgba(255,255,255,0.65)" }}>
                        {signal.detail}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center px-8 py-12 relative">
        <div
          className="absolute top-0 right-0 w-96 h-96 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(212,175,55,0.05) 0%, transparent 70%)",
          }}
        />

        <div className="w-full max-w-md relative z-10">
          {/* Mobile logo */}
          <div className="lg:hidden mb-8 text-center">
            <div className="inline-flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{
                  background:
                    "linear-gradient(135deg, #D4AF37 0%, #C5A030 100%)",
                }}
              >
                <Zap className="w-6 h-6" style={{ color: "#0B1220" }} />
              </div>
              <h1
                className="text-2xl font-bold"
                style={{ color: "#D4AF37" }}
              >
                VertaX
              </h1>
            </div>
          </div>

          <div
            className="rounded-2xl p-8"
            style={{
              background: "rgba(255,255,255,0.03)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
            }}
          >
            {submitted ? (
              /* Success state */
              <div className="text-center py-4">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
                  style={{ background: "rgba(34,197,94,0.15)" }}
                >
                  <CheckCircle2
                    className="w-8 h-8"
                    style={{ color: "#22c55e" }}
                  />
                </div>
                <h3
                  className="text-xl font-bold mb-2"
                  style={{ color: "#ffffff" }}
                >
                  已收到你的预约信息
                </h3>
                <p
                  className="text-sm mb-8"
                  style={{ color: "rgba(255,255,255,0.6)" }}
                >
                  我们会在 1 个工作日内联系你，并按你填写的行业、目标市场和当前问题准备诊断重点。
                  <br />
                  你也可以通过以下方式直接联系我们：
                </p>

                <div className="space-y-4">
                  <div
                    className="flex items-center gap-3 p-4 rounded-xl"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <Mail
                      className="w-5 h-5 flex-shrink-0"
                      style={{ color: "#D4AF37" }}
                    />
                    <div className="text-left">
                      <p
                        className="text-xs"
                        style={{ color: "rgba(255,255,255,0.5)" }}
                      >
                        邮件咨询
                      </p>
                      <a
                        href="mailto:contact@vertax.top"
                        className="text-sm font-medium hover:underline"
                        style={{ color: "#D4AF37" }}
                      >
                        contact@vertax.top
                      </a>
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-3 p-4 rounded-xl"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <MessageSquare
                      className="w-5 h-5 flex-shrink-0"
                      style={{ color: "#D4AF37" }}
                    />
                    <div className="text-left">
                      <p
                        className="text-xs"
                        style={{ color: "rgba(255,255,255,0.5)" }}
                      >
                        微信咨询
                      </p>
                      <p
                        className="text-sm font-medium"
                        style={{ color: "rgba(255,255,255,0.9)" }}
                      >
                        扫码添加解决方案顾问
                      </p>
                    </div>
                  </div>
                </div>

                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 mt-8 text-sm font-medium hover:underline"
                  style={{ color: "rgba(255,255,255,0.5)" }}
                >
                  <ArrowLeft className="w-4 h-4" />
                  返回登录
                </Link>
              </div>
            ) : (
              /* Form */
              <>
                <div className="text-center mb-6">
                  <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium"
                    style={{
                      background: "rgba(212,175,55,0.12)",
                      color: "#D4AF37",
                      border: "1px solid rgba(212,175,55,0.18)",
                    }}
                  >
                    <Building2 className="h-3.5 w-3.5" />
                    Enterprise growth intake
                  </div>
                  <h2
                    className="mt-4 text-2xl font-bold"
                    style={{ color: "#ffffff" }}
                  >
                    预约增长诊断
                  </h2>
                  <p
                    className="text-sm mt-1"
                    style={{ color: "rgba(255,255,255,0.6)" }}
                  >
                    这不是自助注册。我们会先判断你们当前最值得启动的市场表达、获客或内容闭环。
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <div
                      className="rounded-xl p-3"
                      style={{
                        background: "rgba(239,68,68,0.1)",
                        border: "1px solid rgba(239,68,68,0.2)",
                      }}
                    >
                      <p className="text-sm" style={{ color: "#ef4444" }}>
                        {error}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label
                        className="text-xs font-medium"
                        style={{ color: "rgba(255,255,255,0.7)" }}
                      >
                        姓名 <span style={{ color: "#D4AF37" }}>*</span>
                      </label>
                      <Input
                        name="name"
                        placeholder="您的姓名"
                        required
                        className="h-11"
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "#ffffff",
                        }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        className="text-xs font-medium"
                        style={{ color: "rgba(255,255,255,0.7)" }}
                      >
                        手机 <span style={{ color: "rgba(255,255,255,0.3)" }}>(选填)</span>
                      </label>
                      <Input
                        name="phone"
                        type="tel"
                        placeholder="手机号码"
                        className="h-11"
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "#ffffff",
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      className="text-xs font-medium"
                      style={{ color: "rgba(255,255,255,0.7)" }}
                    >
                      公司名称 <span style={{ color: "#D4AF37" }}>*</span>
                    </label>
                    <Input
                      name="company"
                      placeholder="您所在的公司"
                      required
                      className="h-11"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#ffffff",
                      }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      className="text-xs font-medium"
                      style={{ color: "rgba(255,255,255,0.7)" }}
                    >
                      工作邮箱 <span style={{ color: "#D4AF37" }}>*</span>
                    </label>
                    <Input
                      name="email"
                      type="email"
                      placeholder="you@company.com"
                      required
                      className="h-11"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#ffffff",
                      }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      className="text-xs font-medium"
                      style={{ color: "rgba(255,255,255,0.7)" }}
                    >
                      所属行业 <span style={{ color: "rgba(255,255,255,0.3)" }}>(选填)</span>
                    </label>
                    <select
                      name="industry"
                      className="h-11 w-full rounded-md px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30"
                      defaultValue=""
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#ffffff",
                      }}
                    >
                      <option value="" style={{ color: "#0B1220" }}>请选择</option>
                      <option value="制造业" style={{ color: "#0B1220" }}>制造业</option>
                      <option value="工业设备" style={{ color: "#0B1220" }}>工业设备</option>
                      <option value="工业材料 / 化工" style={{ color: "#0B1220" }}>工业材料 / 化工</option>
                      <option value="自动化 / 机器人" style={{ color: "#0B1220" }}>自动化 / 机器人</option>
                      <option value="技术服务" style={{ color: "#0B1220" }}>技术服务</option>
                      <option value="其他" style={{ color: "#0B1220" }}>其他</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      className="text-xs font-medium"
                      style={{ color: "rgba(255,255,255,0.7)" }}
                    >
                      目标市场 / 重点区域 <span style={{ color: "rgba(255,255,255,0.3)" }}>(选填)</span>
                    </label>
                    <Input
                      name="market"
                      placeholder="如：北美、欧洲、中东"
                      className="h-11"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#ffffff",
                      }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      className="text-xs font-medium"
                      style={{ color: "rgba(255,255,255,0.7)" }}
                    >
                      当前最想先解决的问题 <span style={{ color: "#D4AF37" }}>*</span>
                    </label>
                    <select
                      name="priority"
                      required
                      className="h-11 w-full rounded-md px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30"
                      defaultValue=""
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#ffffff",
                      }}
                    >
                      <option value="" style={{ color: "#0B1220" }}>请选择</option>
                      <option value="市场表达不清" style={{ color: "#0B1220" }}>市场表达不清</option>
                      <option value="目标客户不够准" style={{ color: "#0B1220" }}>目标客户不够准</option>
                      <option value="内容增长断裂" style={{ color: "#0B1220" }}>内容增长断裂</option>
                      <option value="线索跟进不连续" style={{ color: "#0B1220" }}>线索跟进不连续</option>
                      <option value="老板看不到经营节奏" style={{ color: "#0B1220" }}>老板看不到经营节奏</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      className="text-xs font-medium"
                      style={{ color: "rgba(255,255,255,0.7)" }}
                    >
                      留言{" "}
                      <span style={{ color: "rgba(255,255,255,0.3)" }}>
                        (选填)
                      </span>
                    </label>
                    <textarea
                      name="message"
                      rows={3}
                      placeholder="可补充目前的海外销售方式、独立站情况、内容现状，或你希望 30 天内先看到什么变化。"
                      className="w-full rounded-md px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/30"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#ffffff",
                      }}
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-12 text-base font-medium mt-2"
                    disabled={loading}
                    style={{
                      background:
                        "linear-gradient(135deg, #D4AF37 0%, #C5A030 100%)",
                      color: "#0B1220",
                      boxShadow: "0 8px 24px -8px rgba(212,175,55,0.4)",
                      border: "none",
                    }}
                  >
                    {loading ? "提交中..." : "提交预约"}
                  </Button>
                </form>

                <p
                  className="text-center mt-5 text-xs"
                  style={{ color: "rgba(255,255,255,0.4)" }}
                >
                  提交即表示你同意我们基于上述信息安排沟通与诊断，我们不会将你的信息用于无关用途。
                </p>
              </>
            )}
          </div>

          <p
            className="text-center mt-6 text-sm"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            已有账户？{" "}
            <Link
              href="/login"
              className="font-medium hover:underline"
              style={{ color: "#D4AF37" }}
            >
              登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
