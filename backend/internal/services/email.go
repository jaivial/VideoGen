package services

import (
	"fmt"
	"net/smtp"

	"video-generator/internal/config"
)

type EmailService struct {
	cfg *config.Config
}

func NewEmailService(cfg *config.Config) *EmailService {
	return &EmailService{cfg: cfg}
}

func (s *EmailService) SendVerificationEmail(to, token string) error {
	if s.cfg.SMTPHost == "" {
		// Skip email sending in development
		fmt.Printf("DEV: Would send verification email to %s with token %s\n", to, token)
		return nil
	}

	verificationURL := fmt.Sprintf("http://localhost:3000/verify?token=%s", token)

	subject := "Verify your email"
	body := fmt.Sprintf(`
		<html>
		<body>
			<h2>Welcome!</h2>
			<p>Please verify your email by clicking the link below:</p>
			<p><a href="%s">%s</a></p>
			<p>This link expires in 24 hours.</p>
		</body>
		</html>
	`, verificationURL, verificationURL)

	return s.sendEmail(to, subject, body)
}

func (s *EmailService) sendEmail(to, subject, body string) error {
	from := s.cfg.SMTPFrom
	auth := smtp.PlainAuth("", s.cfg.SMTPUser, s.cfg.SMTPPass, s.cfg.SMTPHost)

	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n%s",
		from, to, subject, body)

	err := smtp.SendMail(
		fmt.Sprintf("%s:%s", s.cfg.SMTPHost, s.cfg.SMTPPort),
		auth,
		from,
		[]string{to},
		[]byte(msg),
	)

	if err != nil {
		return fmt.Errorf("failed to send email: %w", err)
	}

	return nil
}
