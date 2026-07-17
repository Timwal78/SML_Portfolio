FactoryBot.define do
  factory :user do
    email    { Faker::Internet.unique.email }
    password { 'SecurePassword123!' }
    password_confirmation { 'SecurePassword123!' }
  end
end
