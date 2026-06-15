FactoryBot.define do
  factory :agent do
    association :owner, factory: :user
    name         { "#{Faker::Company.name} Agent" }
    description  { Faker::Lorem.sentence(word_count: 15) }
    endpoint_url { "https://#{Faker::Internet.domain_name}" }
    status       { 'active' }

    trait :available do
      last_seen_at { Time.current }
    end

    trait :away do
      status       { 'away' }
      last_seen_at { 10.minutes.ago }
    end

    trait :with_capability do
      after(:create) { |agent| create(:capability, agent:) }
    end

    trait :staked do
      staked_amount   { 500 }
      staked_currency { 'USDC' }
    end
  end
end
